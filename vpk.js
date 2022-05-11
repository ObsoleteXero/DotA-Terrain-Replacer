import { fstatSync, readSync, openSync } from "node:fs";

class VPK {
  constructor(path) {
    this.path = path;
    this.header_length = 28;
  }

  readHeader() {
    const fd = openSync(this.path, "r");
    const header = Buffer.alloc(this.header_length);
    readSync(fd, header, 0, this.header_length, 0);
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

  static readcString(file, startPosition) {
    let cString = "";
    let position = startPosition;
    const index = Buffer.alloc(64);
    do {
      try {
        readSync(file, index, 0, 64, position);
        const pos = index.indexOf(0);
        if (pos > -1) {
          cString += index.slice(0, pos).toString();
          position += cString.length + 1;
          break;
        }
        cString += index.toString();
      } catch (Readerr) {
        return ["", position];
      }
    } while (position < fstatSync(file).size);
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
          const metadata = [
            metadataBuffer.readUInt32LE(0), // crc32
            metadataBuffer.readUInt16LE(4), // preload_length
            metadataBuffer.readUInt16LE(6), // archive_index
            metadataBuffer.readUInt32LE(8), // archive_offset
            metadataBuffer.readUInt32LE(12), // file_length
            metadataBuffer.readUInt16LE(16), // suffix
          ];

          if (metadata[5] !== 65535) {
            throw new Error("Error while parsing index");
          }
          if (metadata[2] === 32767) {
            metadata[3] += this.header_length + this.tree_length;
          }

          const preload = Buffer.alloc(metadata[1]);
          pos += readSync(fd, preload, 0, metadata[1], pos);
          metadata.splice(0, 0, `${path + name}.${ext}`, preload);
          metadata.pop();
          yield metadata;
        }
      }
    }
  }

  readIndex() {
    this.index = {};
    for (const metadata of this.getIndex()) {
      const path = metadata.shift();
      this.index[path] = metadata;
    }
  }
}

const mapFile = new VPK("dota.vpk");
mapFile.readHeader();
mapFile.readIndex();
console.log(mapFile.index);
