import Registry from "winreg";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";

async function getSteamPath() {
  // Find Steam install directory
  return new Promise((resolve, reject) => {
    const regKey = new Registry({
      hive: Registry.HKCU,
      key: "\\Software\\Valve\\Steam",
    });

    regKey.values((err, items) => {
      if (err) {
        reject(err);
      }
      resolve(
        path.resolve(items.find(({ name }) => name === "SteamPath")?.value)
      );
    });
  });
}

async function getDotaPath() {
  // Find Dota install directory
  const steamPath = await getSteamPath();
  const libraryFolders = path.resolve(
    steamPath,
    "steamapps",
    "libraryfolders.vdf"
  );

  // Parse libraryfolders.vdf and extract the path to the Dota 2 directory
  const file = await readFile(libraryFolders, "utf8");
  let pathText = file.substring(0, file.indexOf(file.match(/"570"\s+"\d+"/)));
  pathText = pathText.substring(pathText.lastIndexOf('"path"'));
  const match = pathText.match(/"path"\s+"(.+)"/);

  return path.resolve(match[1], "steamapps", "common", "dota 2 beta", "game");
}

const DotaPath = await getDotaPath();

async function getBasePath() {
  // Return path to base terrain file
  return path.resolve(DotaPath, "dota", "maps", "dota.vpk");
}

async function getGuestPath(terrain) {
  // Return path to the selected terrain file
  return path.resolve(DotaPath, "dota", "maps", `${terrain}`);
}

async function tempcontent(language = "tempcontent") {
  // Create tempcontent location and return the path
  const tempcontentPath = path.resolve(DotaPath, `dota_${language}`, "maps");
  await mkdir(tempcontentPath, { recursive: true });
  return path.resolve(tempcontentPath, "dota.vpk");
}

const terrains = {
  "Desert Terrain": "dota_desert.vpk",
  "The King's New Journey": "dota_journey.vpk",

  "Immortal Gardens": "dota_coloseum.vpk",
  "Overgrown Empire": "dota_jungle.vpk",
  "Reef's Edge": "dota_reef.vpk",
  "Sanctums of the Divine": "dota_ti10.vpk",
  "The Emerald Abyss": "dota_cavern.vpk",

  "Seasonal Terrain: Autumn": "dota_autumn.vpk",
  "Seasonal Terrain: Winter": "dota_winter.vpk",
  "Seasonal Terrain: Spring": "dota_spring.vpk",
  "Seasonal Terrain: Summer": "dota_summer.vpk",
};

const BasePath = await getBasePath();

export { terrains, BasePath, getGuestPath, tempcontent };
