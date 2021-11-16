# Uniswap V3 DAI/OPIUM Liquidity Mining calculator

This script is calculating Uniswap V3 DAI/OPIUM Liquidity Mining rewards to display on `Opium Liquidity Mining interface`

Config:
- `fromBlock` block from which rewards are calculated
- `toBlock` block till which rewards are calculated
- `batchBlocks` number of blocks for the batch rewards (ex. every 1000 blocks)
- `batchRewards` number of $OPIUM tokens allocated to one batch

Flow:
- Script iterates over all block batches and allocates rewards for each batch
- Each batch is retreiving Uniswap V3 state from subgraph in provided block number
- All Uniswap V3 positions that have liquidity including current tick are getting rewards in pro-rata basis based on their liquidity in current tick
- If the positon holder happpens to be `G-UNI DAI/OPIUM` Pool, then rewards are distributed to all `G-UNI` holders in pro-rata basis based on their balance

The script exposes GraphQL API to be comppatible with `Opium Liquidity Mining interface`

Currently hosted on: `https://opium-lm.loca.lt/graphql`
