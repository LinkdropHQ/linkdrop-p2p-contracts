const hre = require("hardhat");
const {ethers} = require("hardhat");

async function deployLinkdropContract(contractName) {
  const Escrow = await ethers.getContractFactory(contractName);
  const escrow = await Escrow.deploy(
    "0x5f34815add697d7DE0a8b850F23905CF12B4bdc0",
  )
  
  console.log(`${contractName} is deployed to:`, escrow.address)
}

async function main() {
  await deployLinkdropContract("LinkdropEscrow")  
  await deployLinkdropContract("LinkdropEscrowNFT")  
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
