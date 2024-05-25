const hre = require("hardhat");
const {ethers} = require("hardhat");


async function main() {
  const Escrow = await ethers.getContractFactory("LinkdropEscrow");
  const escrow = await Escrow.deploy(
    "0x5f34815add697d7DE0a8b850F23905CF12B4bdc0",
  )  
  console.log("LinkdropEscrow is deployed to:", escrow.address)
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
