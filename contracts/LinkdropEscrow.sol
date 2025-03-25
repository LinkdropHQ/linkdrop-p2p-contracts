// SPDX-License-Identifier: GPL-3.0
/**
 * @title LinkdropEscrowStablecoin
 * @author Mikhail Dobrokhvalov <mikhail@linkdrop.io>
 * @contact https://www.linkdrop.io
 * @dev This is an implementation of the escrow contract for Linkdrop P2P. Linkdrop P2P allows a new type of token transfers, comparable to a signed blank check with a pre-defined amount. In this system, the sender does not set the destination address. Instead, they deposit tokens into the Escrow Contract, create a claim link, and share it with the recipient. The recipient can then use the claim link to redeem the escrowed tokens from the Escrow Contract. If the claim link is not redeemed before the expiration date set by the sender, the escrowed tokens are transferred back to the sender.
 */
pragma solidity ^0.8.17;
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC721/IERC721.sol";
import "openzeppelin-solidity/contracts/utils/cryptography/ECDSA.sol";
import "./LinkdropEscrowCommon.sol";
import "./libraries/TransferHelper.sol";

error ERC6492DeployFailed(bytes error);

contract LinkdropEscrow is LinkdropEscrowCommon {
    string public constant name = "LinkdropEscrow";
    string public constant version = "3.2";
    bytes32 private constant ERC6492_DETECTION_SUFFIX = 0x6492649264926492649264926492649264926492649264926492649264926492;
    
    //// CONSTRUCTOR ////
    constructor(
                address relayer_
    ) EIP712(name, version) {
        relayers[relayer_] = true;
    }
    
    //// PUBLIC FUNCTIONS ////
    function deposit(address token_,
                     address transferId_,
                     uint128 amount_,
                     uint120 expiration_,
                     address feeToken_,
                     uint128 feeAmount_,
                     bytes calldata feeAuthorization_,
                     bytes calldata senderMessage_
                    ) public
        nonReentrant
        payable {
        bool feesAuthorized_ = verifyFeeAuthorization(
                                                      msg.sender,
                                                      token_,
                                                      transferId_,
                                                      0, // tokenId is 0 for ERC20
                                                      amount_,
                                                      expiration_,
                                                      feeToken_,
                                                      feeAmount_,
                                                      feeAuthorization_);
        require(feesAuthorized_, "LinkdropEscrow: Fees not authorized.");        
        require(token_ != address(0), "LinkdropEscrow: can't be address(0) as a token.");
        
        TransferHelper.safeTransferFrom(token_, msg.sender, address(this), uint256(amount_));

        // store sender's message onchain (encrypted)
        _logSenderMessage(msg.sender, transferId_, senderMessage_);
        
         // stablecoins have fees in the same token
        if (feeToken_ == token_) {
            return _depositStablecoins(msg.sender, token_, transferId_, amount_, expiration_, uint128(feeAmount_));
        }
        
        // all other ERC20 tokens have fees in native tokens
        return _depositERC20(msg.sender, token_, transferId_, amount_, expiration_, feeToken_, uint128(feeAmount_));
    }
    
    
    /**
     * @dev deposit is used to perform direct deposits. In this case depositFee is 0
     */
    function depositETH(
                     address transferId_,
                     uint128 amount_,
                     uint120 expiration_,
                     uint128 feeAmount_,
                     bytes calldata feeAuthorization_,
                     bytes calldata senderMessage_
    ) public
        nonReentrant
        payable {
        bool feesAuthorized_ = verifyFeeAuthorization(
                                                      msg.sender,
                                                      address(0), // token is 0x000..000 for ETH
                                                      transferId_,
                                                      0, // tokenId is 0 for ETH transfers
                                                      amount_,
                                                      expiration_,
                                                      address(0), // fee token is 0x000..000 for ETH
                                                      feeAmount_,
                                                      feeAuthorization_);
        require(feesAuthorized_, "Fees not authorized.");        
        require(deposits[msg.sender][address(0)][transferId_].amount == 0, "LinkdropEscrow: transferId is in use.");
        require(expiration_ > block.timestamp, "LinkdropEscrow: depositing with invalid expiration.");
        require(msg.value == amount_, "LinkdropEscrow: amount not covered.");       
        require(amount_ > feeAmount_, "LinkdropEscrow: amount does not cover fee.");
        
        amount_ = uint128(amount_ - feeAmount_);
    
        _makeDeposit(
                     msg.sender,
                     address(0), // token is 0x000..000 for ETH
                     transferId_,
                     0, // token id is 0 for ETH
                     amount_,
                     expiration_,
                     0, // tokentype is 0 for ETH
                     address(0), // token is 0x000..000 for ETH
                     feeAmount_);

        // store sender's message onchain (encrypted)
        _logSenderMessage(msg.sender, transferId_, senderMessage_);        
    }
  
    //// ONLY RELAYER ////
    function depositWithAuthorization(
                                      address token_,
                                      address transferId_,
                                      uint120 expiration_,
                                      bytes4 authSelector_,
                                      uint128 fee_,
                                      bytes calldata receiveAuthorization_,
                                      bytes calldata senderMessage_
    ) public
        onlyRelayer
    {
        // Validate authorization selector
        require(
                authSelector_ == 0xe1560fd3 || authSelector_ == 0xef55bec6 || authSelector_ == 0x88b7ab63,
                "LinkdropEscrow: invalid selector"
        );


        // Decode authorization and retrieve details
        (address from_, uint256 amount_) = _processAuthorization(token_, transferId_, authSelector_, receiveAuthorization_, expiration_, fee_);
        
        // Perform deposit logic
        _depositStablecoins(from_, token_, transferId_, uint128(amount_), expiration_, fee_);
        
        // Log the optional sender message
        _logSenderMessage(from_, transferId_, senderMessage_);
    }
    
    function _processAuthorization(
                                   address token_,
                                   address transferId_,
                                   bytes4 authSelector_,
                                   bytes calldata receiveAuthorization_,
                                   uint120 expiration_,
                                   uint128 fee_
    ) private returns (address from_, uint256 amount_) {
        address to_;
        uint256 validAfter_;
        uint256 validBefore_;
        bytes32 nonce;

        (from_, to_, amount_, validAfter_, validBefore_, nonce) = abi.decode(
            receiveAuthorization_[0:192],
            (address, address, uint256, uint256, uint256, bytes32)
        );

        require(to_ == address(this), "LinkdropEscrow: Invalid recipient");
        require(
            keccak256(abi.encodePacked(from_, transferId_, amount_, expiration_, fee_)) == nonce,
            "LinkdropEscrow: Invalid nonce"
        );

        (bool success, ) = token_.call(abi.encodePacked(authSelector_, receiveAuthorization_));
        require(success, "LinkdropEscrow: approve failed");

        // Transfer tokens if using approveWithAuthorization        
        if (authSelector_ == 0xe1560fd3) {
            TransferHelper.safeTransferFrom(token_, from_, address(this), amount_);
        }
        
        return (from_, amount_);
    }
    
    //// INTERNAL FUNCTIONS //// 
    function _depositStablecoins(
                                 address sender_,
                                 address token_,
                                 address transferId_,
                                 uint128 amount_,
                                 uint120 expiration_,
                                 uint128 feeAmount_
    ) private {
        require(deposits[sender_][token_][transferId_].amount == 0, "LinkdropEscrow: transferId is in use.");
        require(expiration_ > block.timestamp, "LinkdropEscrow: depositing with invalid expiration.");
        require(token_ != address(0), "LinkdropEscrow: token should not be address(0)");
        require(amount_ > feeAmount_, "LinkdropEscrow: amount does not cover fee.");
        require(msg.value == 0, "LinkdropEscrow: fees should be paid in token not ether");
    
        amount_ = uint128(amount_ - feeAmount_);    
        _makeDeposit(
                     sender_,
                     token_,
                     transferId_,
                     0, // tokenId is 0 for ERC20
                     amount_,
                     expiration_,
                     1, // tokenType is 1 for ERC20
                     token_,
                     feeAmount_);
    }

    function _depositERC20(
                           address sender_,
                           address token_,
                           address transferId_,
                           uint128 amount_,
                           uint120 expiration_,
                           address feeToken_,
                           uint128 feeAmount_
    ) private {
        require(deposits[sender_][token_][transferId_].amount == 0, "LinkdropEscrow: transferId is in use.");
        require(expiration_ > block.timestamp, "LinkdropEscrow: depositing with invalid expiration.");
        require(feeToken_ == address(0), "LinkdropEscrow: fees for ERC20 tokens can be paid in native tokens only.");
        require(token_ != address(0), "LinkdropEscrow: token should not be address(0)");    
        require(msg.value == feeAmount_, "LinkdropEscrow: fee not covered.");
    
        _makeDeposit(
                     sender_,
                     token_,
                     transferId_,
                     0, // tokenId is 0 for ERC20
                     amount_,
                     expiration_,
                     1, //tokenType, 1 - for ERC20
                     feeToken_,
                     feeAmount_);
    } 
}
