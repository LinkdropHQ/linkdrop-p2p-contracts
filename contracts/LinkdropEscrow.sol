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

contract LinkdropEscrow is LinkdropEscrowCommon {
    string public constant name = "LinkdropEscrow";
    string public constant version = "3.1";
    
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
                     bytes calldata feeAuthorization_
    ) public nonReentrant payable {
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

         // stablecoins have fees in the same token
        if (feeToken_ == token_) {
            return _depositStablecoins(msg.sender, token_, transferId_, amount_, expiration_, feeToken_, uint128(feeAmount_));
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
                     bytes calldata feeAuthorization_
    ) public nonReentrant payable {
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
    }

  
    //// ONLY RELAYER ////
    function depositWithAuthorization(
                                      address token_,
                                      address transferId_,
                                      uint120 expiration_,
                                      bytes4 authorizationSelector_,                                                                 
                                      uint128 fee_,
                                      bytes calldata receiveAuthorization_
    ) public onlyRelayer {

        // native USDC supports receiveWithAuthorization and bridged USDC.e supports approveWithAuthorization instead. Selector should be one of the following depending on the token contract:
        // 0xe1560fd3 - approveWithAuthorization selector
        // 0xef55bec6 - recieveWithAuthorization selector
        require(authorizationSelector_ == 0xe1560fd3 || authorizationSelector_ == 0xef55bec6, "LinkdropEscrow: invalid selector");    
      
        address from_;
        address to_;
        uint256 amount_;

        {
            // Retrieving deposit information from receiveAuthorization_
            uint256 validAfter_;
            uint256 validBefore_;
            bytes32 nonce;
    
            (from_,
             to_,
             amount_,
             validAfter_,
             validBefore_,       
             nonce) = abi.decode(
                                 receiveAuthorization_[0:192], (
                                                                address,
                                                                address,
                                                                uint256,
                                                                uint256,
                                                                uint256,
                                                                bytes32
                                 ));

            require(to_ == address(this), "LinkdropEscrow: receiveAuthorization_ decode fail. Recipient is not this contract.");
            require(keccak256(abi.encodePacked(from_, transferId_, amount_, expiration_, fee_)) == nonce, "LinkdropEscrow: receiveAuthorization_ decode fail. Invalid nonce.");

            (bool success, ) = token_.call(
                                           abi.encodePacked(
                                                            authorizationSelector_,
                                                            receiveAuthorization_
                                           )
            );
            require(success, "LinkdropEscrow: approve failed.");
        }

        // if approveWithAuthorization (for bridged USDC.e)
        // transfer tokens from sender to the escrow contract
        if (authorizationSelector_ == 0xe1560fd3) { 
            TransferHelper.safeTransferFrom(token_, from_, address(this), uint256(amount_));
        } // if receiveWithAuthorization (for native USDC) nothing is needed to be done
    
        _depositStablecoins(from_, token_, transferId_, uint128(amount_), expiration_, token_, fee_);
    }

    
    //// INTERNAL FUNCTIONS ////
  
    function _depositStablecoins(
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
        require(feeToken_ == token_, "LinkdropEscrow: Fees for transfers in stablecoins should be paid in the stablecoin token.");
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
                     feeToken_,
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
