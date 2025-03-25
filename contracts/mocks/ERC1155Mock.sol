// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "openzeppelin-solidity/contracts/token/ERC1155/ERC1155.sol";

contract ERC1155Mock is ERC1155 {
    uint256 public tokenCount = 0;

    constructor() public ERC1155("") {
    }
    
    
    function mintTo(address account, uint256 id, uint256 amount)
        public 
    {
        _mint(account, id, amount, new bytes(0));
    }

}
