const hre = require("hardhat");
const {ethers} = require("hardhat");

async function main() {
  const Escrow = await ethers.getContractFactory("LinkdropEscrow");
  const escrow = await Escrow.deploy(
      "0x47BeD7bD268DB9E8ca094947Ec6840f105114228",
      "0x47BeD7bD268DB9E8ca094947Ec6840f105114228",
      150000,
      150000,
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174" // USDC address
  )
  console.log("LinkdropEscrow is deployed to:", escrow.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
