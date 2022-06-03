import readline from "node:readline";
import { getGuestPath, terrains, BasePath, tempcontent } from "./utils.js";
import patchTerrain from "./vpk.js";

const terrainNames = Object.keys(terrains);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  console.log("Select a Terrain to apply: \n");

  terrainNames.forEach((terrain, index) => {
    console.log(`${index + 1}: ${terrain}`);
  });

  let selection;
  rl.question("\nEnter a number: ", async (answer) => {
    const terrain = terrainNames[answer - 1];
    selection = terrains[terrain];
    if (!selection) {
      console.log("Invalid selection.");
      process.exit(1);
    }
    await patchTerrain(
      BasePath,
      await getGuestPath(selection),
      await tempcontent()
    );
    console.log(
      `Applied Terrain: ${terrain}. Launch Dota 2 with the "-language tempcontent" launch option`
    );
    rl.close();
  });
}

main().catch(console.error);
