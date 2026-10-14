// Hardhat is only used as a local chain for tests (contracts are compiled by scripts/compile.mjs).
module.exports = {
  solidity: '0.8.28',
  paths: { sources: './test/hh-empty', cache: './test/.hh-cache', artifacts: './test/.hh-artifacts' },
  networks: {
    hardhat: { chainId: 4663, initialBaseFeePerGas: 0, accounts: { count: 10 } },
  },
}
