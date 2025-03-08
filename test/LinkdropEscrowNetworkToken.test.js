const { expect } = require("chai");
const hre = require("hardhat");
const getAuthorization = require("../utils/getEIP3009Authorization")
const { generateLinkKeyandSignature, generateReceiverSig, generateFeeAuthorization } = require("../utils/escrowSigUtils");

let owner;
let feeReceiver;
let relayer;
let LinkdropEscrow;
let linkdropEscrow;
let sender;
let transferId;
let linkKeyWallet;
let tokenAddr = ethers.constants.AddressZero
const depositFee = ethers.utils.parseUnits("0.001", 18);

// Generate validAfter and validBefore timestamps
function getValidAfterAndBefore() {
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60; // valid 1 minute ago
  const validBefore = now + 60 * 60; // valid for the next 1 hour
  return [validAfter, validBefore];
}

async function prepareDepositCall(sponsored, senderMessage) {
 // Define some values for the deposit
  let amount = ethers.utils.parseUnits("0.1", 18);  // 100 ETH
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
  const fee = sponsored ? 0 : depositFee;
  
  const feeAuthorization = await generateFeeAuthorization(
    relayer,
    sender.address,
    tokenAddr,
    transferId,
    0, // tokenId
    amount,
    expiration,
    tokenAddr,
    fee)

  // User deposits ETH into LinkdropEscrow
  const depositCall = () => linkdropEscrow.connect(sender).depositETH(
    transferId,
    amount,
    expiration,
    fee,
    feeAuthorization,
    senderMessage,
    { value: amount } 
  );

  return { 
    depositCall,
    transferId,
    amount,
    expiration,
  }
}

async function makeDeposit (sponsored=true, senderMessage="0x") {
  const {
    depositCall,
    transferId,
    amount,
    expiration,
  } = await prepareDepositCall(sponsored, senderMessage)

  await depositCall()
  
  return {
    transferId,
    amount,
    expiration,
  }
}

async function redeemRecovered () {
  // User redeems MockETH from LinkdropEscrow
  const chainId = await sender.getChainId();       
  const transferDomain = {
    name: "LinkdropEscrow",
    version: "3.2",
    chainId, // Replace with your actual chainId
    verifyingContract: linkdropEscrow.address, // Replace with your actual contract address
  }
  let { linkKey: newLinkKey, newLinkKeyId, senderSig } = await generateLinkKeyandSignature(sender, transferId, transferDomain)
  const newLinkKeyWallet = new ethers.Wallet(newLinkKey)
  const receiverSig = await generateReceiverSig(newLinkKeyWallet, receiver.address)
  await linkdropEscrow.connect(relayer).redeemRecovered(receiver.address, sender.address, tokenAddr, transferId, receiverSig, senderSig);
}

describe("LinkdropEscrowNetworkToken", function () {
  beforeEach(async function () {
    [owner,feeReceiver, relayer, sender, linkKeyWallet, ...addrs] = await ethers.getSigners();
    receiver = ethers.Wallet.createRandom()
    transferId = linkKeyWallet.address;
    
    LinkdropEscrow = await ethers.getContractFactory("LinkdropEscrow");
    linkdropEscrow = await LinkdropEscrow.deploy(relayer.address);    
    await linkdropEscrow.deployed();
  });

  describe("escrow contract", function () {
    it("Should have correct owner", async function () {
      await expect(await linkdropEscrow.owner()).to.be.equal(owner.address)
    })
  })
  
  describe("deposit", function () {    
    it("Should deposit ETH (sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      
      // Check that the ETH was transferred
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees(tokenAddr)).to.equal(0);

      const deposit = await linkdropEscrow.getDeposit(tokenAddr, sender.address, transferId)
      expect(deposit.amount).to.equal(amount);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(ethers.constants.AddressZero);      
    })
    
    it("Should deposit ETH (not sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit(false)
      
      // Check that the ETH was transferred
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(amount);
      expect(await linkdropEscrow.accruedFees(tokenAddr)).to.equal(depositFee);

      const deposit = await linkdropEscrow.getDeposit(tokenAddr, sender.address, transferId)
      expect(deposit.amount).to.equal(amount.sub(depositFee));
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(ethers.constants.AddressZero);
    })

    it("Should log sender message in event", async function () {
      const senderMessage = "0x002a5a48f0eee01056febc3398e98d70e4d05936395b0a1fce28abaa333f6712720b5acc8e1fb4b721bb8ab423db2121e12fcd7eaa41c97731fdf56a8638"
      const { depositCall, amount, expiration, transferId } = await prepareDepositCall(false, message=senderMessage)

      // Verify the event was emitted with the correct parameters
      await expect(await depositCall())
      .to.emit(linkdropEscrow, "SenderMessage")
      .withArgs(sender.address, transferId, senderMessage);
    })
    
    it("Should redeem ETH via original claim link ", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      const receiverSig = await generateReceiverSig(linkKeyWallet, receiver.address)
      await linkdropEscrow.connect(relayer).redeem(receiver.address, sender.address, tokenAddr, receiverSig);

      // Check that the ETH was redeemed
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(0);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(tokenAddr, sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees(tokenAddr)).to.equal(0);     
    })

    it("Should redeem ETH via recovered link ", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(amount);
      
      // REDEEM 
      await redeemRecovered(true)
      
      // Check that the ETH was redeemed
      expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(0);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(tokenAddr, sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees(tokenAddr)).to.equal(0);       
    })
    
    describe("withdraw fees", function () {
      
      it("Should withdraw accrued fees", async function () {
        const { amount, expiration, transferId } = await makeDeposit(false)
        await redeemRecovered()
        let accruedAmount = await linkdropEscrow.accruedFees(tokenAddr)
        expect(accruedAmount).to.equal(depositFee);
        let ownerBalance = await ethers.provider.getBalance(owner.address)
        let escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
        
        await linkdropEscrow.connect(owner).withdrawAccruedFees(tokenAddr)
        expect(await linkdropEscrow.accruedFees(tokenAddr)).to.equal(0);
        expect(await ethers.provider.getBalance(owner.address)).to.be.gt(ownerBalance);
        expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(escrowBalance - accruedAmount);
      })
      
      it("Should not withdraw accrued fees multiple times", async function () {
        const { amount, expiration, transferId } = await makeDeposit()              
        const accruedAmount = await linkdropEscrow.accruedFees(tokenAddr)
        expect(accruedAmount).to.equal(0);
        const ownerBalance = await ethers.provider.getBalance(owner.address)
        const escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
        
        await linkdropEscrow.connect(owner).withdrawAccruedFees(tokenAddr)
        expect(await linkdropEscrow.accruedFees(tokenAddr)).to.equal(0);
        expect(await ethers.provider.getBalance(owner.address)).to.be.lt(ownerBalance);
        expect(await ethers.provider.getBalance(linkdropEscrow.address)).to.equal(escrowBalance);      
      })
    });    
  })
  
  describe("refund", function () {
    
    it("Should fail if the caller is not a relayer", async function () {
      const { amount, expiration, transferId } = await makeDeposit()
      
      // Try to refund funds as another user
      await expect(
        linkdropEscrow.connect(addrs[0]).refund(sender.address, tokenAddr, transferId)
      ).to.be.revertedWith("LinkdropEscrow: msg.sender is not relayer.");
    });

    it("Should refund ETH to original sender", async function () {
      
      const { amount, expiration, transferId } = await makeDeposit()
      const ethBalanceAfterDeposit = await ethers.provider.getBalance(sender.address)
      
      // wait for 25 hours
      await network.provider.send("evm_increaseTime", [60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block
      
      // Refund the deposit
      await linkdropEscrow.connect(relayer).refund(sender.address, tokenAddr, transferId);

      // Check that the ETH was refunded and deposit is zero
      expect(await ethers.provider.getBalance(sender.address)).to.equal(ethBalanceAfterDeposit.add(amount));
      expect((await linkdropEscrow.getDeposit(tokenAddr, sender.address, transferId)).amount).to.equal(0);
      expect(await linkdropEscrow.accruedFees(tokenAddr)).to.equal(0);

      // reset back EVM time
      await network.provider.send("evm_increaseTime", [-60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block            
    });    
  });

});
