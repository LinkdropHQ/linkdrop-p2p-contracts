# Linkdrop P2P Contracts Overview
## About
Linkdrop P2P allows a new type of token transfers that can be compared to a signed blank check with a pre-defined amount, where sender doesn't set destination address, but instead deposits tokens to Escrow Contract, creates a claim link and shares it with a recipient. Recipient can use the claim link to redeem the escrowed tokens from the Escrow Contract. If the claim link is not redeemed before the expiration set by Sender, the escrowed tokens is transfered back to Sender.  
### Goals & security assumptions
  - Enable token transfers to people that don’t have crypto accounts yet.
  - Receiver can redeem tokens to any address by following the claim URL.
  - Sender doesn't have to know recipient's crypto account address.
  - Claim link can be redeemed only once in a first come first served fashion.
  - Sevice is non-custodial as long as it doesn't have access to the private key stored in the URL (link key) that is known only to Sender and Receiver.
  - Sender should share the claim URL (and the link key) only with the recipient via a secure channel (email, e2e chat, QR code).
  - The link key is stored in the part of the URL after “#”, which means that browsers don’t expose it while fetching the webpage code from a server. Linkdrop Service never has access to the private link key itself.
  - The private link Key is ephemeral. It cannot be used in any way after the link is canceled, claimed or expired.
  
### Architecture

Components:
  - Relaying Server
  - Web App
  - Escrow Contract

#### Creaing Claim Link for USDC (gaslessly via EIP-3009 transferWithAuthorization signature):
![Sender_flow](https://user-images.githubusercontent.com/4770810/261793777-bd21ed6b-7aee-48e8-a6fa-18f28dbbaa1a.png)

  1. Sender using Web App generates random transfer ID for the claim link, sets expiration time of the link, and creates EIP-3009 transfer-with-authorization signature. Receiving address in the transfer should be Escrow Smart Contract. To ensure that Relaying Server can not modify expiration time and or transfer ID, nonce in the EIP-3009 signature should be a keccak256 hash of sender address, transfer ID, amount, expiration. 
  2. Web App passes EIP-3009 signature, transfer ID, expiration time to Relaying Server. Relaying Server calls depositWithAuthorization function of the Escrow Contract
  3. Escrow Contract verifies that in the EIP-3009 signature: a) receiving address is the Escrow Contract and b) nonce is a correctly computed keccak256 hash (see 1.). If everything is correct, the Escrrow Contract transfers USDC from sender to itself. If claim links are not sponsored, a fixed fee (depends on the chain, e.g. 0.3 USDC for Polygon) is deducted from the transfer amount and goes to an adress controlled by Linkdrop Service.
  4. After deposit is successful, Sender generates an ephemeral secret link key and signs a EIP-712 message (`Transfer(linkKeyId, transferId)`) to generate claim URL. `LinkKeyId` is the first (index=0) Ethereum address corresponding to the link key. 
  5. Sender shares claim URL with Receiver via a secure channel (e2e chat, email, QR code, etc)
  
### URL scheme
```js
const url = ${domain}/#/${token}?k=${linkKey}${senderSig}${transferId}&c=${chainId}
# where:
## domain - domain where Web App is hosted, e.g. https://send.linkdrop.io
## token - token symbol or address that is sent via the payment link, e.g. USDC
## k - a private link key, encoded in base58 format
## s - the sender ethereum address, encoded in base58 format 
## c - chain ID where the transfer is happening
## v - version of Linkdrop Contracts
```

Example URL: 
https://p2p.linkdrop.io/#/usdc?k=HWVsGht24jzkm9WY7H3pf12Aw8xVKxXTMtr5kGHtTrfX&s=4ERZxxdBnFj1PV2pTdzyp51UugLN&c=80001&v=2
  
### Redeeming Payment Link
![Redeem_flow](https://user-images.githubusercontent.com/4770810/261793814-2ffdf277-4d6e-48bc-a32d-a739ad4802bf.png)

### Redeeming Payment Link
1. Receiver gets the claim link from Sender
2. Receiver follows the URL and if needed sets up a new Ethereum account
3. Receiver using Web App, grabs and decodes link key, sender address and decodes transfer ID from the link key and generates receiver signature by signing receiving address with the link key.
4. Receiver passes sender signature, receiver signature, receiving address and transfer ID to Relaying Server.
5. Relaying Server calls the Escrow Contract's redeem function.
6. Escrow Contract verifies that receiving address was signed by the link key.
  If everything is correct, the Escrow Contract transfers the escrowed tokens to the receiving address. 

### Expired Payment Links
If the claim link is not redeemed before the expiration time, it can not be redeemed anymore. Instead, Relaying Server calls the Escrow Contract to transfer the escrowed tokens back to Sender. 
