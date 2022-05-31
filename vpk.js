import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, parse } from "node:path";
import crc32 from "buffer-crc32";

const { createHash } = await import("node:crypto");

class VPK {
  constructor(path) {
    this.path = path;
    this.header_length = 28;
  }

  async read() {
    this.vpkData = await readFile(this.path);
    await this.readHeader();
    await this.readIndex();
  }

  async readHeader() {
    const header = this.vpkData.subarray(0, this.header_length);
    [
      this.signature,
      this.version,
      this.tree_length,
      this.embed_chunk_length,
      this.chunk_hashes_length,
      this.self_hashes_length,
      this.signature_length,
    ] = new Uint32Array(
      header.buffer,
      header.byteOffset,
      header.length / Uint32Array.BYTES_PER_ELEMENT
    );
  }

  createFilePath(metadata) {
    return this.path
      .replace("english", "")
      .replace("dir.", `${metadata.archive_index.padStart(3, "0")}.`);
  }

  static async readcString(buffer, startPosition) {
    let cString = "";
    let position = startPosition;
    const index = buffer.subarray(startPosition, startPosition + 64);
    do {
      const pos = index.indexOf(0);
      if (pos > -1) {
        cString += index.subarray(0, pos).toString();
        position += cString.length + 1;
        break;
      }
      cString += index.toString();
    } while (position < buffer.length);
    return [cString, position];
  }

  async *getIndex(buffer) {
    let pos = 0;
    let ext;
    let path;
    let name;

    while (true) {
      [ext, pos] = await VPK.readcString(buffer, pos);
      if (!ext) break;

      while (true) {
        [path, pos] = await VPK.readcString(buffer, pos);
        if (!path) break;
        if (path !== " ") {
          path += "/";
        } else {
          path = "";
        }

        while (true) {
          [name, pos] = await VPK.readcString(buffer, pos);
          if (!name) break;

          const metadataBuffer = buffer.subarray(pos, pos + 18);
          const metadata = {};
          pos += 18;
          [
            metadata.path,
            metadata.crc32,
            metadata.preload_length,
            metadata.archive_index,
            metadata.archive_offset,
            metadata.file_length,
            metadata.suffix,
          ] = [
            `${path}${name}.${ext}`,
            metadataBuffer.readUInt32LE(0),
            metadataBuffer.readUInt16LE(4),
            metadataBuffer.readUInt16LE(6),
            metadataBuffer.readUInt32LE(8),
            metadataBuffer.readUInt32LE(12),
            metadataBuffer.readUInt16LE(16),
          ];

          if (metadata.suffix !== 65535) {
            throw new Error("Error while parsing index");
          }
          if (metadata.archive_index === 32767) {
            metadata.archive_offset += this.header_length + this.tree_length;
          }

          delete metadata.suffix;
          yield metadata;
        }
      }
    }
  }

  async readIndex() {
    this.index = {};
    for await (const metadata of this.getIndex(
      this.vpkData.subarray(this.header_length, this.vpkData.length)
    )) {
      const { path } = metadata;
      delete metadata.path;
      this.index[path] = metadata;
    }
  }
}

class VPKFile {
  constructor(vpk, path, metadata) {
    this.vpk = vpk;
    this.path = path;
    this.metadata = metadata;
    this.vpkData = this.vpk.vpkData;

    for (const [key, value] of Object.entries(metadata)) {
      this[key] = value;
    }

    if (this.metadata.preload !== "") {
      this.metadata.preload = "...";
    }

    this.length = this.preload_length + this.file_length;
    this.offset = 0;
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const fileBuffer = this.vpkData.subarray(
      this.archive_offset,
      this.archive_offset + this.file_length
    );
    await writeFile(this.path, fileBuffer);
  }

  async getFileData() {
    const fileBuffer = this.vpkData.subarray(
      this.archive_offset,
      this.archive_offset + this.length
    );
    return { path: this.path, data: fileBuffer };
  }
}

async function saveVPK(path, data) {
  const filelist = Object.keys(data);
  const tree = {};
  let treeLength = 0;
  const headerLength = 28;

  // Create tree using fileList
  filelist.forEach((file) => {
    const filePath = parse(file);
    const ext = filePath.ext.replace(".", "");

    if (ext in tree) {
      if (filePath.dir in tree[ext]) {
        tree[ext][filePath.dir].push(filePath.name);
      } else {
        tree[ext][filePath.dir] = [filePath.name];
      }
    } else {
      tree[ext] = { [filePath.dir]: [filePath.name] };
    }
  });

  // Calculate tree length
  for (const ext of Object.keys(tree)) {
    treeLength += ext.length + 2;
    for (const dir of Object.keys(tree[ext])) {
      treeLength += dir.length + 2;
      for (const file of tree[ext][dir]) {
        treeLength += file.length + 19;
      }
    }
  }
  treeLength += 1;

  // Write File
  let dataOffset = headerLength + treeLength;

  const treeBufferArray = [];
  const treeDataArray = [];
  let embedChunkLength = 0;
  for (const ext of Object.keys(tree)) {
    treeBufferArray.push(Buffer.from(`${ext}\0`));

    for (const dir of Object.keys(tree[ext])) {
      treeBufferArray.push(Buffer.from(`${dir}\0`));

      for (const file of tree[ext][dir]) {
        treeBufferArray.push(Buffer.from(`${file}\0`));

        // Write Metadata
        const fileOffset = dataOffset;
        const realFilename = !ext ? file : `${file}.${ext}`;

        const fileData = data[`${dir}/${realFilename}`];
        const checksum = crc32.unsigned(fileData);

        const metadata = Buffer.alloc(18);
        metadata.writeUInt32LE(checksum, 0); // crc32  & 4294967295
        metadata.writeUInt16LE(0, 4); // preload_length
        metadata.writeUInt16LE(32767, 6); // archive_index
        metadata.writeUInt32LE(fileOffset - treeLength - headerLength, 8); // archive_offset
        metadata.writeUInt32LE(fileData.length, 12); // file_length
        metadata.writeUInt16LE(65535, 16); // suffix

        treeBufferArray.push(metadata);
        treeDataArray.push(fileData);
        embedChunkLength += fileData.length;
        dataOffset += fileData.length;
      }
      // Next dir
      treeBufferArray.push(Buffer.from("\0"));
    }
    // Next ext
    treeBufferArray.push(Buffer.from("\0"));
  }
  // End of tree
  treeBufferArray.push(Buffer.from("\0"));

  // Create header
  const header = Buffer.alloc(headerLength);
  header.writeUInt32LE(0x55aa1234); // signature
  header.writeUInt32LE(2, 4); // version
  header.writeUInt32LE(treeLength, 8); // tree_length
  header.writeUInt32LE(embedChunkLength, 12); // embed_chunk_length
  header.writeUInt32LE(0, 16); // chunk_hashes_length
  header.writeUInt32LE(48, 20); // self_hashes_length
  header.writeUInt32LE(0, 24);

  // Hash
  const fileChecksum = createHash("md5");
  const chunkHashesChecksum = createHash("md5");
  const treeChecksum = createHash("md5");

  treeChecksum.update(Buffer.concat(treeBufferArray));
  fileChecksum.update(
    Buffer.concat([...[header], ...treeBufferArray, ...treeDataArray])
  );

  const treeDigest = treeChecksum.digest();
  const chunkDigest = chunkHashesChecksum.digest();

  fileChecksum.update(treeDigest);
  fileChecksum.update(chunkDigest);

  const hashes = Buffer.concat([
    treeDigest,
    chunkDigest,
    fileChecksum.digest(),
  ]);

  // Save
  await writeFile(
    path,
    Buffer.concat([
      ...[header],
      ...treeBufferArray,
      ...treeDataArray,
      ...[hashes],
    ])
  );
}

async function patchTerrain(terrain) {
  // Unpack the default map file
  const baseMap = new VPK("dota.vpk");
  await baseMap.readVPK();
  const baseData = [];
  for (const [path, metadata] of Object.entries(baseMap.index)) {
    const file = new VPKFile(baseMap, path, metadata);
    baseData.push(await file.getFileData());
  }

  // Unpack selected terrain
  const guestMap = new VPK(terrain);
  await guestMap.readVPK();
  const guestData = [];
  for (const [path, metadata] of Object.entries(guestMap.index)) {
    const file = new VPKFile(guestMap, path, metadata);
    guestData.push(await file.getFileData());
  }

  // Patch base with guest
  const patchedData = {};

  guestData.forEach((guestFileArray) => {
    let { path } = guestFileArray;
    const { data } = guestFileArray;

    if (extname(path) === ".vmap_c") {
      path = `${dirname(path)}/dota.vmap_c`;
    }

    patchedData[path] = data;
  });

  baseData.forEach((baseFileArray) => {
    const { path, data } = baseFileArray;

    if (path in patchedData) {
      return;
    }

    patchedData[path] = data;
  });

  // Create new VPK
  await saveVPK("patched.vpk", patchedData);
}

async function extractVPK() {
  const mapFile = new VPK("patched.vpk");
  await mapFile.read();

  for (const [path, metadata] of Object.entries(mapFile.index)) {
    const file = new VPKFile(mapFile, path, metadata);
    await file.save();
  }
}

async function patchFunction() {
  await patchTerrain("dota_coloseum.vpk");
}

extractVPK().catch(console.error);
// patchFunction().catch(console.error);
