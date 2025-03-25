const hre = require("hardhat");
const {ethers} = require("hardhat");
const { generateLinkKeyandSignature, generateReceiverSig } = require("../utils/escrowSigUtils");

async function main() {
  const [deployer] = await ethers.getSigners();

  const USDC_ADDRESS = "0x0FA8781a83E46826621b3BC094Ea2A0212e71B23";
  const LINKDROPE_ESCROW_ADDRESS = "0x05bAD9004Ece0B5caDc0749e7623b879D8b675e1";
  
  const LinkdropEscrow = await hre.ethers.getContractFactory("LinkdropEscrow");
  const linkdropEscrow = LinkdropEscrow.attach(LINKDROPE_ESCROW_ADDRESS); // replace with your LinkdropEscrow contract address

  const chainId = await deployer.getChainId(); 

  // Define the transferId, receiverSig, senderSig
  const transferId = "1345678"; // replace with the transferId

  const receiverAddress = '0xbe2e44608d395d97c77b2045e28936c6862747b2'; // replace with the receiver's address

  // User redeems MockUSDC from LinkdropEscrow      
  const transferDomain = {
    name: "LinkdropEscrow",
    version: "1",
    chainId, // Replace with your actual chainId
    verifyingContract: linkdropEscrow.address, // Replace with your actual contract address
  }
  let { linkKey, linkKeyId, senderSig } = await generateLinkKeyandSignature(deployer, transferId, transferDomain)

  const receiverSig = await generateReceiverSig(linkKey, receiverAddress)
  
  // Call the redeem function
  const redeemTx = await linkdropEscrow.connect(deployer).redeem(receiverAddress, transferId, receiverSig, senderSig);

  console.log({ redeemTx })
  
  // Wait for the transaction to be mined
  const receipt = await redeemTx.wait();

  console.log('Transaction was successful:', receipt.status === 1);

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

