const hre = require("hardhat");
const {ethers} = require("hardhat");
const getAuthorization = require('../utils/getEIP3009Authorization');

// Generate validAfter and validBefore timestamps
function getValidAfterAndBefore() {
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now - 60 * 60; // valid 1 hour ago
    const validBefore = now + 60 * 60 * 24; // valid for the next 24 hours
    return [validAfter, validBefore];
}


async function main() {
  const [deployer] = await ethers.getSigners();

  
  const transferId = "1345678"

  const USDC_ADDRESS = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
  const LINKDROPE_ESCROW_ADDRESS = "0x0522DD6e9f2BEca1cd15A5FD275dC279A1A08eac";

  const usdc = await ethers.getContractAt('MockUSDC', USDC_ADDRESS, deployer);
  const linkdropEscrow = await ethers.getContractAt('LinkdropEscrow', LINKDROPE_ESCROW_ADDRESS, deployer);

  const amount = ethers.utils.parseUnits("0.1", 6); 
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; 

  const name =  await usdc.name();
  //const version = await usdc.version();
  const version = "1"
  const chainId = await deployer.getChainId();

  const domain = {
    name: name,
    version: version,
    verifyingContract: usdc.address,
    salt: ethers.utils.hexZeroPad(ethers.utils.hexlify(chainId), 32)    
  };

  console.log({ domain })
  
  console.log("before auth")
  
  const [validAfter, validBefore] = getValidAfterAndBefore();
  console.log({ to: linkdropEscrow.address, deployer: deployer.address, amount, validAfter, validBefore, transferId, expiration, domain })
  const authorization = await getAuthorization(deployer, linkdropEscrow.address, amount, validAfter, validBefore, transferId, expiration, domain);

  console.log({ authorization })
  
  const tx = await linkdropEscrow.depositWithAuthorization(
    transferId,
    expiration,
    true,
    authorization
  );

  console.log({ tx })
  
  console.log('Deposit successful');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
