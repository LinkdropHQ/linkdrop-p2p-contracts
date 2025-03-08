const { expect } = require("chai");
const hre = require("hardhat");
const getAuthorization = require("../utils/getEIP3009Authorization")
const { generateLinkKeyandSignature, generateReceiverSig, generateFeeAuthorization } = require("../utils/escrowSigUtils");

let owner;
let feeReceiver;
let relayer;
let LinkdropEscrow;
let linkdropEscrow;
let token;
let sender;
let transferId;
let linkKeyWallet;

const depositFee = ethers.utils.parseUnits("0.1", 18);
const feeToken = ethers.constants.AddressZero

// Generate validAfter and validBefore timestamps
function getValidAfterAndBefore() {
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60; // valid 1 minute ago
  const validBefore = now + 60 * 60; // valid for the next 1 hour
  return [validAfter, validBefore];
}

async function prepareDepositCall(sponsored=true, senderMessage="0x") {
 // Define some values for the deposit
  const amount = ethers.utils.parseUnits("100", 6);  // 100 TOKEN
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours from now
  const fee = sponsored ? 0 : depositFee;

  const feeAuthorization = await generateFeeAuthorization(
    relayer,
    sender.address,
    token.address,
    transferId,
    0, // 0 as tokenId for ERC20
    amount,
    expiration,
    feeToken,
    fee)
  
  await token.connect(sender).approve(linkdropEscrow.address, amount);
    // User deposits MockTOKEN into LinkdropEscrow
  const depositCall = () => linkdropEscrow.connect(sender).deposit(
    token.address,
    transferId,
    amount,
    expiration,
    feeToken,
    fee,
    feeAuthorization,
    senderMessage,
    { value: fee }
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
  // User redeems MockTOKEN from LinkdropEscrow
  const chainId = await sender.getChainId();       
  const transferDomain = {
    name: "LinkdropEscrow",
    version: "3.2",
    chainId, 
    verifyingContract: linkdropEscrow.address, 
  }
  let { linkKey: newLinkKey, newLinkKeyId, senderSig } = await generateLinkKeyandSignature(sender, transferId, transferDomain)
  const newLinkKeyWallet = new ethers.Wallet(newLinkKey)
  const receiverSig = await generateReceiverSig(newLinkKeyWallet, receiver.address)
  await linkdropEscrow.connect(relayer).redeemRecovered(receiver.address, sender.address, token.address, transferId, receiverSig, senderSig);
}

describe("LinkdropEscrowERC20", function () {
  beforeEach(async function () {
    [owner,feeReceiver, relayer, sender, receiver, linkKeyWallet, ...addrs] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockUSDC");
    token = await Token.deploy();

    await token.transfer(sender.address, ethers.utils.parseUnits("10000", 6));
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
    it("Should deposit token direclty (not sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit(false)
      
      // Check that the token was transferred
      const fees = depositFee
      expect(await token.balanceOf(linkdropEscrow.address)).to.equal(amount);
      let escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
      expect(escrowBalance).to.equal(depositFee);      
      expect(await linkdropEscrow.accruedFees(feeToken)).to.equal(fees);

      const deposit = await linkdropEscrow.getDeposit(token.address, sender.address, transferId)
      expect(deposit.amount).to.equal(amount);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(token.address);
    })
    
    it("Should log sender message in event", async function () {
      const senderMessage = "0x002a5a48f0eee01056febc3398e98d70e4d05936395b0a1fce28abaa333f6712720b5acc8e1fb4b721bb8ab423db2121e12fcd7eaa41c97731fdf56a8638"
      const { depositCall, amount, expiration, transferId } = await prepareDepositCall(false, message=senderMessage)

      // Verify the event was emitted with the correct parameters
      await expect(await depositCall())
      .to.emit(linkdropEscrow, "SenderMessage")
      .withArgs(sender.address, transferId, senderMessage);
    })

    
    it("Should deposit token directly (sponsored)", async function () {
      const { amount, expiration, transferId } = await makeDeposit(true)      

      // Check that the token was transferred
      expect(await token.balanceOf(linkdropEscrow.address)).to.equal(amount);
      let escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
      expect(escrowBalance).to.equal(0);      
      
      expect(await linkdropEscrow.accruedFees(feeToken)).to.equal(0);

      const deposit = await linkdropEscrow.getDeposit(token.address, sender.address, transferId)
      expect(deposit.amount).to.equal(amount);
      expect(deposit.expiration).to.equal(expiration);
      expect(deposit.token).to.equal(token.address);
    })
  })

  describe("withdraw fees", function () {
    it("Should withdraw accrued fees", async function () {
      const { amount, expiration, transferId } = await makeDeposit(false)      
      let accruedAmount = await linkdropEscrow.accruedFees(feeToken)
      expect(accruedAmount).to.equal(depositFee);
      
      let escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
      let ownerBalance = await ethers.provider.getBalance(owner.address)      
      expect(escrowBalance).to.equal(depositFee);      

      
      await linkdropEscrow.connect(owner).withdrawAccruedFees(feeToken)
      expect(await linkdropEscrow.accruedFees(feeToken)).to.equal(0);

      escrowBalance = await ethers.provider.getBalance(linkdropEscrow.address)
      expect(await ethers.provider.getBalance(owner.address)).to.be.gt(ownerBalance);
      expect(escrowBalance).to.equal(0);
    })    
  })
           
  describe("redeem", function () {
    it("Should redeem token via original claim link", async function () {
      const { amount, expiration, transferId } = await makeDeposit(true)
      const receiverSig = await generateReceiverSig(linkKeyWallet, receiver.address)
      await linkdropEscrow.connect(relayer).redeem(receiver.address, sender.address, token.address, receiverSig);

      // Check that the token was redeemed
      expect(await token.balanceOf(linkdropEscrow.address)).to.equal(0);
      expect(await token.balanceOf(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(token.address, sender.address, transferId)).amount).to.equal(0);
    })

    it("Should redeem token via recovered link", async function () {
      const { amount, expiration, transferId } = await makeDeposit(true)
      expect(await token.balanceOf(linkdropEscrow.address)).to.equal(amount);
      
      // REDEEM 
      await redeemRecovered()
      
      // Check that the TOKEN was redeemed
      expect(await token.balanceOf(linkdropEscrow.address)).to.equal(0);
      expect(await token.balanceOf(receiver.address)).to.equal(amount);
      expect((await linkdropEscrow.getDeposit(token.address, sender.address, transferId)).amount).to.equal(0);
    })

  });

  
  describe("refund", function () {    
    it("Should fail if the caller is not a relayer", async function () {
      const { amount, expiration, transferId } = await makeDeposit(true)
      
      // Try to refund funds as another user
      await expect(
        linkdropEscrow.connect(addrs[0]).refund(sender.address, token.address, transferId)
      ).to.be.revertedWith("LinkdropEscrow: msg.sender is not relayer.");
    });

    it("Should refund token to original sender", async function () {      
      const { amount, expiration, transferId } = await makeDeposit(true)
      const tokenBalanceAfterDeposit = await token.balanceOf(sender.address)
      
      // wait for 25 hours
      await network.provider.send("evm_increaseTime", [60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block
      
      // Refund the deposit
      await linkdropEscrow.connect(relayer).refund(sender.address, token.address, transferId);

      // Check that the TOKEN was refunded and deposit is zero
      expect(await token.balanceOf(sender.address)).to.equal(tokenBalanceAfterDeposit.add(amount));
      expect((await linkdropEscrow.getDeposit(token.address, sender.address, transferId)).amount).to.equal(0);

      // reset back EVM time
      await network.provider.send("evm_increaseTime", [-60 * 60 * 25]);  // Increase time by 25 hours
      await network.provider.send("evm_mine");  // Mine the next block      
    });    
  });
  
});
