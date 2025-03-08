// SPDX-License-Identifier: GPL-3.0
/**
 * @title LinkdropEscrowNFT
 * @author Mikhail Dobrokhvalov <mikhail@linkdrop.io>
 * @contact https://www.linkdrop.io
 * @dev This is an implementation of the escrow contract for Linkdrop P2P. Linkdrop P2P allows a new type of token transfers, comparable to a signed blank check with a pre-defined amount. In this system, the sender does not set the destination address. Instead, they deposit tokens into the Escrow Contract, create a claim link, and share it with the recipient. The recipient can then use the claim link to redeem the escrowed tokens from the Escrow Contract. If the claim link is not redeemed before the expiration date set by the sender, the escrowed tokens are transferred back to the sender.
 */
pragma solidity ^0.8.17;
import "openzeppelin-solidity/contracts/token/ERC721/IERC721.sol";
import "openzeppelin-solidity/contracts/token/ERC1155/IERC1155.sol";
import "./LinkdropEscrowCommon.sol";

contract LinkdropEscrowNFT is LinkdropEscrowCommon {
    string public constant name = "LinkdropEscrowNFT";
    string public constant version = "3.2";
    
    //// CONSTRUCTOR ////
    constructor(
                address relayer_
    ) EIP712(name, version) {
        relayers[relayer_] = true;
    }

    function decodeOnERC721ReceivedData(bytes calldata data_) public pure returns (address transferId, uint120 expiration, uint128 feeAmount, bytes calldata feeAuthorization) {
        (
         transferId,
         expiration,
         feeAmount
        ) = abi.decode(data_, (address, uint120, uint128));
        feeAuthorization = data_[data_.length - 96: data_.length - 31];
        return (transferId, expiration, feeAmount, feeAuthorization);
    }
    
    function onERC721Received(address operator_, address from_, uint256 tokenId_, bytes calldata data_) external returns(bytes4) {
        if (address(this) == operator_) {
            return this.onERC721Received.selector;
        }

        uint256 requiredDataLength_ = 116; // 20(transferId)+15(expiration)+16(feeAmount)+65(feeAuthorization)
        require(data_.length >= requiredDataLength_, "Data length is insufficient");

        (address transferId_, uint120 expiration_, uint128 feeAmount_, bytes calldata feeAuthorization_) = decodeOnERC721ReceivedData(data_);
        
        _depositERC721(from_, msg.sender, transferId_, tokenId_, expiration_, feeAmount_, feeAuthorization_);
        return this.onERC721Received.selector;
    }
    
    function depositERC721(address token_,
                           address transferId_,
                           uint256 tokenId_,
                           uint120 expiration_,
                           uint128 feeAmount_,
                           bytes calldata feeAuthorization_,
                           bytes calldata senderMessage_
                          ) public nonReentrant payable {
        _depositERC721(msg.sender, token_, transferId_, tokenId_, expiration_, feeAmount_, feeAuthorization_);
        IERC721(token_).safeTransferFrom(msg.sender, address(this), tokenId_);

        // store sender's message onchain (encrypted)
        _logSenderMessage(msg.sender, transferId_, senderMessage_);        
    }

    function _depositERC721(
                            address sender_, 
                            address token_,
                            address transferId_,
                            uint256 tokenId_,
                            uint120 expiration_,
                            uint128 feeAmount_,
                            bytes calldata feeAuthorization_) internal {
        bool feesAuthorized_ = verifyFeeAuthorization(
                                                      sender_,
                                                      token_,
                                                      transferId_,
                                                      tokenId_,
                                                      1, // amount is 1 for ERC721
                                                      expiration_,
                                                      address(0),
                                                      feeAmount_,
                                                      feeAuthorization_);
        require(feesAuthorized_, "LinkdropEscrow: Fees not authorized.");
        require(token_ != address(0), "LinkdropEscrow: can't be address(0) as a token.");        
        require(deposits[sender_][token_][transferId_].amount == 0, "LinkdropEscrow: transferId is in use.");
        require(expiration_ > block.timestamp, "LinkdropEscrow: depositing with invalid expiration.");
        require(msg.value == feeAmount_, "LinkdropEscrow: fee not covered.");
            
        _makeDeposit(
                     sender_,
                     token_,
                     transferId_,
                     tokenId_,
                     1, // amount is 1 for ERC721
                     expiration_,
                     2, // tokenType is 2 for ERC721
                     address(0),
                     feeAmount_);
    }


        
    function onERC1155Received(address operator_, address from_, uint256 tokenId_, uint256 amount_, bytes calldata data_) external returns(bytes4) {
            
        require(amount_ <=  2**128 - 1, "amount exceeds maximum allowed value for uint128"); 
        if (address(this) == operator_) {
            return this.onERC1155Received.selector;
        }

        uint256 requiredDataLength_ = 116; // 20(transferId)+15(expiration)+16(feeAmount)+65(feeAuthorization)
        require(data_.length >= requiredDataLength_, "Data length is insufficient");

        
        (address transferId_, uint120 expiration_, uint128 feeAmount_, bytes calldata feeAuthorization_) = decodeOnERC721ReceivedData(data_);
        
        _depositERC1155(from_, msg.sender, transferId_, tokenId_, uint128(amount_), expiration_, feeAmount_, feeAuthorization_);
        return this.onERC1155Received.selector;
    }
    
    function depositERC1155(address token_,
                            address transferId_,
                            uint256 tokenId_,
                            uint128 amount_,                            
                            uint120 expiration_,
                            uint128 feeAmount_,
                            bytes calldata feeAuthorization_,
                            bytes calldata senderMessage_
                           ) public nonReentrant payable {
        _depositERC1155(msg.sender, token_, transferId_, tokenId_, amount_, expiration_, feeAmount_, feeAuthorization_);
        IERC1155(token_).safeTransferFrom(msg.sender, address(this), tokenId_, uint256(amount_), new bytes(0));

        // store sender's message onchain (encrypted)
        _logSenderMessage(msg.sender, transferId_, senderMessage_);
    }

    function _depositERC1155(
                             address sender_, 
                             address token_,
                             address transferId_,
                             uint256 tokenId_,
                             uint128 amount_,
                             uint120 expiration_,
                             uint128 feeAmount_,
                             bytes calldata feeAuthorization_) internal {
        bool feesAuthorized_ = verifyFeeAuthorization(
                                                      sender_,
                                                      token_,
                                                      transferId_,
                                                      tokenId_,
                                                      amount_,
                                                      expiration_,
                                                      address(0),
                                                      feeAmount_,
                                                      feeAuthorization_);
        require(amount_ != 0, "Amount is not provided");
        require(feesAuthorized_, "LinkdropEscrow: Fees not authorized.");
        require(token_ != address(0), "LinkdropEscrow: can't be address(0) as a token.");        
        require(deposits[sender_][token_][transferId_].amount == 0, "LinkdropEscrow: transferId is in use.");
        require(expiration_ > block.timestamp, "LinkdropEscrow: depositing with invalid expiration.");
        require(msg.value == feeAmount_, "LinkdropEscrow: fee not covered.");
            
        _makeDeposit(
                     sender_,
                     token_,
                     transferId_,
                     tokenId_,
                     amount_,
                     expiration_,
                     3, // tokenType is 3 for ERC1155
                     address(0),
                     feeAmount_);
    }      
}
