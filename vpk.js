import {
  fstatSync,
  readSync,
  writeSync,
  openSync,
  closeSync,
  mkdirSync,
} from "node:fs";
import { dirname, extname, sep, parse } from "node:path";
import crc32 from "buffer-crc32";

class VPK {
  constructor(path) {
    this.path = path;
    this.header_length = 28;

    this.readHeader();
    this.readIndex();
  }

  readHeader() {
    const fd = openSync(this.path, "r");
    const header = Buffer.alloc(this.header_length);
    readSync(fd, header, 0, this.header_length, 0);
    closeSync(fd);
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

  static readcString(file, startPosition) {
    let cString = "";
    let position = startPosition;
    const filesize = fstatSync(file).size;
    const index = Buffer.alloc(64);
    do {
      try {
        readSync(file, index, 0, 64, position);
        const pos = index.indexOf(0);
        if (pos > -1) {
          cString += index.subarray(0, pos).toString();
          position += cString.length + 1;
          break;
        }
        cString += index.toString();
      } catch (Readerr) {
        return ["", position];
      }
    } while (position < filesize);
    return [cString, position];
  }

  *getIndex() {
    const fd = openSync(this.path, "r");
    let pos = this.header_length;
    let ext;
    let path;
    let name;

    while (true) {
      [ext, pos] = VPK.readcString(fd, pos);
      if (!ext) break;

      while (true) {
        [path, pos] = VPK.readcString(fd, pos);
        if (!path) break;
        if (path !== " ") {
          path += "/";
        } else {
          path = "";
        }

        while (true) {
          [name, pos] = VPK.readcString(fd, pos);
          if (!name) break;

          const metadataBuffer = Buffer.alloc(18);
          pos += readSync(fd, metadataBuffer, 0, 18, pos);

          const metadata = {};
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
            metadata.achive_offset += this.header_length + this.tree_length;
          }

          delete metadata.suffix;
          yield metadata;
        }
      }
    }
    closeSync(fd);
  }

  readIndex() {
    this.index = {};
    for (const metadata of this.getIndex()) {
      const { path } = metadata;
      delete metadata.path;
      this.index[path] = metadata;
    }
  }
}

class VPKFile {
  vpkFd;

  vpk;

  constructor(vpk, path, metadata) {
    VPKFile.vpk = vpk;
    this.path = path;
    this.metadata = metadata;

    for (const [key, value] of Object.entries(metadata)) {
      this[key] = value;
    }

    if (this.metadata.preload !== "") {
      this.metadata.preload = "...";
    }

    this.length = this.preload_length + this.file_length;
    this.offset = 0;

    VPKFile.vpkFd = openSync(VPKFile.vpk.path, "r");
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const fileBuffer = Buffer.alloc(this.length);
    readSync(VPKFile.vpkFd, fileBuffer, 0, this.length, this.archive_offset);
    const fd = openSync(this.path, "w");
    writeSync(fd, fileBuffer, 0, fileBuffer.length);
    closeSync(fd);
    closeSync(VPKFile.vpkFd);
  }

  getFileData() {
    const fileBuffer = Buffer.alloc(this.length);
    readSync(VPKFile.vpkFd, fileBuffer, 0, this.length, this.archive_offset);
    closeSync(VPKFile.vpkFd);
    return { path: this.path, data: fileBuffer };
  }
}

const mapFile = new VPK("dota_coloseum.vpk");
mapFile.readHeader();
mapFile.readIndex();

for (const [path, metadata] of Object.entries(mapFile.index)) {
  const file = new VPKFile(mapFile, path, metadata);
  file.save();
}

class NewVPK {
  constructor(path, filelist, data) {
    this.path = path;
    this.filelist = filelist;
    this.data = data;

    this.tree = {};
    this.treeLength = 0;
  }

  createTree() {
    // Create tree using fileList
    this.filelist.forEach((file) => {
      const filePath = parse(file);

      if (filePath.ext in this.tree) {
        if (filePath.dir in this.tree[filePath.ext]) {
          this.tree[filePath.ext][filePath.dir].push(filePath.name);
        } else {
          this.tree[filePath.ext][filePath.dir] = [filePath.name];
        }
      } else {
        this.tree[filePath.ext] = { [filePath.dir]: [filePath.name] };
      }
    });

    // Calculate tree length
    for (const ext of Object.entries(this.tree)) {
      this.treeLength += ext.length + 2;
      for (const dir of Object.entries(this.tree[ext])) {
        this.treeLength += dir.length + 2;
        for (const file of this.tree[ext][dir]) {
          this.treeLength += file.length + 19;
        }
      }
    }
    this.treeLength += 1;
  }

  // // Create header
  // const header = Buffer.alloc(28);
  // header.writeUInt32LE(0x55aa1234); // signature
  // header.writeUInt32LE(2, 4); // version
  // header.writeUInt32LE(treeLength, 8); // tree_length

  // const dataOffset = header.length + treeLength;

  writeTree() {
    for (const ext of Object.entries(this.tree)) {
      let treeBuffer = Buffer.from(`${ext}\0`);
      for (const dir of Object.entries(tree[ext])) {
        treeBuffer = Buffer.concat([treeBuffer, Buffer.from(`${dir}\0`)]);
        for (const file of tree[ext][dir]) {
          treeBuffer = Buffer.concat([treeBuffer, Buffer.from(`${file}\0`)]);

          // Append file data
          const metadataOffset = treeBuffer.length;
          const fileOffset = dataOffset;
          const realFilename = !ext ? file : `${file}.${ext}`;
          const checksum = crc32(data[`${dir}/${realFilename}`]);
        }
      }
    }
  }
}

function patchTerrain(terrain) {
  // Unpack the default map file
  const baseMap = new VPK("dota.vpk");
  const baseData = [];
  for (const [path, metadata] of Object.entries(baseMap.index)) {
    const file = new VPKFile(baseMap, path, metadata);
    baseData.push(file.getFileData());
  }

  // Unpack selected terrain
  const guestMap = new VPK(terrain);
  const guestData = [];
  for (const [path, metadata] of Object.entries(guestMap.index)) {
    const file = new VPKFile(guestMap, path, metadata);
    guestData.push(file.getFileData());
  }

  // Patch base with guest
  const patchedData = [];
  const patchedFiles = [];

  guestData.forEach((guestFileArray) => {
    let path = guestFileArray[0];
    const data = guestFileArray[1];

    if (extname(path) === ".vmap_c") {
      path = `${dirname(path)}${sep}dota.vmap_c`;
    }

    patchedFiles.push(path);
    patchedData.push({ path, data });
  });

  baseData.forEach((baseFileArray) => {
    const path = baseFileArray[0];
    const data = baseFileArray[1];

    if (patchedFiles.includes(path)) {
      return;
    }

    patchedFiles.push(path);
    patchedData.push({ path, data });
  });
}
