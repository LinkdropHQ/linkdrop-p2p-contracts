// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

contract MockUSDC {
    mapping (address => uint) public balances;
    mapping (address => mapping(address => uint256)) public allowance;

    uint public totalSupply = 10**12 * 10**6; // 1 billion tokens, 6 decimals
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    string public version = "1";
    uint public decimals = 6;

    constructor() {
        balances[msg.sender] = totalSupply;
    }

    function transferWithAuthorization(
                                        address from,
                                        address to,
                                        uint256 value,
                                        uint256 validAfter,
                                        uint256 validBefore,
                                        bytes32 nonce,
                                        uint8 v,
                                        bytes32 r,
                                        bytes32 s
                                        ) external {        // Check that the block.timestamp is within validAfter and validBefore
      require(block.timestamp > validAfter, "MockUSDC: The transaction is not yet valid");
      require(block.timestamp < validBefore, "MockUSDC: The transaction is expired");
      
      // For brevity, this example doesn't include verifying the authorization signature
      // In the real implementation, you would verify the signature here
      
        // Transfer the tokens from the authorizer to the recipient
      require(balances[from] >= value, "MockUSDC: Insufficient balance");
      balances[from] -= value;
      balances[to] += value;
    }

    function receiveWithAuthorization(
                                        address from,
                                        address to,
                                        uint256 value,
                                        uint256 validAfter,
                                        uint256 validBefore,
                                        bytes32 nonce,
                                        uint8 v,
                                        bytes32 r,
                                        bytes32 s
                                        ) external {        // Check that the block.timestamp is within validAfter and validBefore
      require(to == msg.sender, "MockUSDC: caller must be the payee");        
      require(block.timestamp > validAfter, "MockUSDC: The transaction is not yet valid");
      require(block.timestamp < validBefore, "MockUSDC: The transaction is expired");
      
      // For brevity, this example doesn't include verifying the authorization signature
      // In the real implementation, you would verify the signature here
      
        // Transfer the tokens from the authorizer to the recipient
      require(balances[from] >= value, "MockUSDC: Insufficient balance");
      balances[from] -= value;
      balances[to] += value;
    }

    function approveWithAuthorization(
                                        address from,
                                        address to,
                                        uint256 value,
                                        uint256 validAfter,
                                        uint256 validBefore,
                                        bytes32 nonce,
                                        uint8 v,
                                        bytes32 r,
                                        bytes32 s
                                        ) external {        // Check that the block.timestamp is within validAfter and validBefore
      require(to == msg.sender, "MockUSDC: caller must be the payee");        
      require(block.timestamp > validAfter, "MockUSDC: The transaction is not yet valid");
      require(block.timestamp < validBefore, "MockUSDC: The transaction is expired");
      
      // For brevity, this example doesn't include verifying the authorization signature
      // In the real implementation, you would verify the signature here
      
        // Transfer the tokens from the authorizer to the recipient     
      require(from != address(0), "ERC20: approve from the zero address");
      require(to != address(0), "ERC20: approve to the zero address");
      
      allowance[from][to] = value;
    }
    
    
    function transfer(address _to, uint _value) public returns (bool success) {
        require(balances[msg.sender] >= _value);
        balances[msg.sender] -= _value;
        balances[_to] += _value;
        return true;
    }

    function transferFrom(address _from, address _to, uint _value) public returns (bool success) {
        require(balances[_from] >= _value);
        require(allowance[_from][msg.sender] >= _value);

        balances[_from] -= _value;
        balances[_to] += _value;
        allowance[_from][msg.sender] -= _value;

        return true;
    }

    function approve(address _spender, uint _value) public returns (bool success) {
        allowance[msg.sender][_spender] = _value;
        return true;
    }

    function balanceOf(address _owner) public view returns (uint balance) {
        return balances[_owner];
    }
}
