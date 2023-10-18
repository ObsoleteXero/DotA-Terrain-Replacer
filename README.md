> [!WARNING]  
> This repository has been archived in favour of [Dota-Terrain-Mod](https://github.com/ObsoleteXero/Dota-Terrain-Mod) which is written in Rust. Further development will be done there.

# DotA Terrain Replacer

This tool patches the default terrain with the selected [Custom Terrain](https://dota2.fandom.com/wiki/Custom_Terrain) and places the modified file in the game files.  
The modified file can be loaded by adding the `-language tempcontent` launch option to Dota 2.

## Usage

```
npm install
node src/mod/cli.js
```

Opens an interactive command line interface.  
The launch option must be added manually.

## Requirements

- NodeJS
- Dota 2
