const axios = require('axios').default
const Web3 = require('web3')
const BN = require('web3').utils.BN

const RPC = 'https://cloudflare-eth.com'

const UNISWAP_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/alirun/uniswap-v3'
const G_UNI_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/alirun/guni'

const POOL_ADDRESS = '0x5cef3aed38eb937f3dc0864307ac6c9a9694abfa'
const G_UNI_ADDRESS = '0x2A2Cd905141F1cDf3620dB6A1eD0Abc4F7E8635C'.toLowerCase()
const MULTIPLIER = 1e12

const BN_BASE = (new BN('10')).pow(new BN('18'))

const web3 = new Web3(new Web3.providers.HttpProvider(RPC))

const getUniswapV3Tick = async (poolAddress, blockNumber) => {
  const result = await axios.post(
    UNISWAP_SUBGRAPH_URL,
    {
      query: `
        query getPools($block_number: Int, $pool_address: ID) {
          pools(block: { number: $block_number }, where: { id: $pool_address }) {
            tick
          }
        }   
      `,
      variables: {
        pool_address: poolAddress.toLowerCase(),
        block_number: blockNumber
      }
    }
  )

  return result.data.data.pools[0].tick
}

const getUniswapV3Positions = async (poolAddress, tick, lastId, blockNumber) => {
  const result = await axios.post(
    UNISWAP_SUBGRAPH_URL,
    {
      query: `
        query getPositions(
          $block_number: Int
          $tick_current: BigInt
          $pool_address: String
          $last_id: ID
        ) {
          positions(
            first: 1000
            block: { number: $block_number }
            where: {
              tickLower_lte: $tick_current
              tickUpper_gt: $tick_current
              pool: $pool_address
              id_gt: $last_id
            }
            orderBy: id
            orderDirection: asc
          ) {
            id
            owner
            liquidity
          }
        }      
      `,
      variables: {
        pool_address: poolAddress.toLowerCase(),
        block_number: blockNumber,
        tick_current: tick,
        last_id: lastId
      }
    }
  )

  return result.data.data.positions
}

const getUniswapV3Balances = async (blockNumber) => {
  const start = Date.now()

  const tick = await getUniswapV3Tick(POOL_ADDRESS, blockNumber)
  const tickPrice = Math.pow(1.0001, +tick) * MULTIPLIER
  console.log(`Tick: ${tick}`)
  console.log(`Tick price: ${tickPrice}`)

  let lastId = ''
  let positions_chunk = await getUniswapV3Positions(POOL_ADDRESS, tick, lastId, blockNumber)
  let positions = positions_chunk
  while (positions_chunk.length >= 1000) {
    lastId = positions_chunk[positions_chunk.length - 1].id
    positions_chunk = await getUniswapV3Positions(POOL_ADDRESS, tick, lastId, blockNumber)
    positions = [...positions, ...positions_chunk]
  }
  console.log(`Got positions: ${positions.length}`)

  const liquidityByOwner = {}
  let totalLiquidity = new BN('0')
  for (const position of positions) {
    if (position.liquidity == '0') {
      continue
    }

    const owner = position.owner.toLowerCase()
    if (!liquidityByOwner[owner]) {
      liquidityByOwner[owner] = new BN('0')
    }

    liquidityByOwner[owner] = liquidityByOwner[owner].add(new BN(position.liquidity))
    totalLiquidity = totalLiquidity.add(new BN(position.liquidity))
  }

  const end = Date.now()
  console.log(`(getUniswapV3Balances) Executed in ${end - start} ms`)

  return { liquidityByOwner, totalLiquidity }
}

const getGUniTotalSupply = async (blockNumber) => {
  const result = await axios.post(
    G_UNI_SUBGRAPH_URL,
    {
      query: `
        query getPools($block_number: Int) {
          pools(block: { number: $block_number }) {
            totalSupply
          }
        }   
      `,
      variables: {
        block_number: blockNumber
      }
    }
  )

  return result.data.data.pools[0] ? result.data.data.pools[0].totalSupply : '0'
}

const getGUniUsers = async (lastId, blockNumber) => {
  const result = await axios.post(
    G_UNI_SUBGRAPH_URL,
    {
      query: `
        query getUsers(
          $block_number: Int
          $last_id: ID
        ) {
          users(
            first: 1000
            block: { number: $block_number }
            where: {
              id_gt: $last_id
            }
            orderBy: id
            orderDirection: asc
          ) {
            id
            balance
          }
        }      
      `,
      variables: {
        block_number: blockNumber,
        last_id: lastId
      }
    }
  )

  return result.data.data.positions
}

const getGUniBalancesDistribution = async (blockNumber) => {
  const start = Date.now()

  const balanceDistribution = {}

  const totalSupply = await getGUniTotalSupply(blockNumber)

  if (totalSupply == '0') {
    return balanceDistribution
  }

  console.log(`GUni Total supply: ${totalSupply}`)

  let lastId = ''
  let users_chunk = await getGUniUsers(blockNumber)
  let users = users_chunk
  while (users.length >= 1000) {
    lastId = users_chunk[users_chunk.length - 1].id
    users_chunk = await getGUniUsers(blockNumber)
    users = [...users, ...users_chunk]
  }
  console.log(`Got users: ${users.length}`)

  let totalSupplyBN = new BN(totalSupply)
  for (const user of users) {
    if (user.balance == '0') {
      continue
    }

    const owner = user.id.toLowerCase()

    balanceDistribution[owner] = (new BN(user.balance.liquidity)).mul(BN_BASE).div(totalSupplyBN)
  }

  const end = Date.now()
  console.log(`(getGUniBalancesDistribution) Executed in ${end - start} ms`)

  return balanceDistribution
}

const calculateRewards = (batchRewards, uniswapBalances, gUniBalancesDistribution) => {
  const { liquidityByOwner, totalLiquidity } = uniswapBalances

  const rewards = {}

  for (const owner in liquidityByOwner) {
    const reward = batchRewards.mul(liquidityByOwner[owner]).div(totalLiquidity)
    
    // If not G-UNI pool, calculate rewards to owners
    if (owner !== G_UNI_ADDRESS) {
      rewards[owner] = reward
      continue
    }

    // If G-UNI pool, calculate rewards to G-UNI holders
    for (const holder in gUniBalancesDistribution) {
      if (!rewards[holder]) {
        rewards[holder] = new BN('0')
      }

      rewards[holder] = rewards[holder].add(
        reward.mul(gUniBalancesDistribution[holder]).div(BN_BASE)
      )
    }
  }

  return rewards
}

const addRewards = (totalRewards, currentRewards) => {
  for (const owner in currentRewards) {
    if (!totalRewards[owner]) {
      totalRewards[owner] = new BN('0')
    }

    totalRewards[owner] = totalRewards[owner].add(currentRewards[owner])
  }
}

const calculateTotalRewards = (totalRewards) => {
  let total = new BN('0')
  for (const owner in totalRewards) {
    total = total.add(totalRewards[owner])
  }

  console.log(`Total distributed: ${total.toString()}`)
}

const printRewards = (totalRewards) => {
  for (let index = 0; index < 3; index++) {
    const owner = Object.keys(totalRewards)[index]
    console.log(`Owner: ${owner} Rewards: ${totalRewards[owner].toString()}`)
  }
}

const recalculate = async (fromBlock, toBlock, batchBlocks) => {
  const totalRewards = {}
  const batchRewards = new BN('1000000000000000000') // 1 OPIUM

  let currentBlock = fromBlock
  while (currentBlock < toBlock) {
    console.log('---------------------------------')
    console.log(`Processing block: ${currentBlock}`)
    
    const [
      uniswapBalances,
      gUniBalancesDistribution
    ] = await Promise.all([
      getUniswapV3Balances(currentBlock),
      getGUniBalancesDistribution(currentBlock)
    ])
    const rewards = calculateRewards(batchRewards, uniswapBalances, gUniBalancesDistribution)
    addRewards(totalRewards, rewards)

    printRewards(totalRewards)

    calculateTotalRewards(totalRewards)

    currentBlock += batchBlocks
  }

  const usersArray = []

  for (const userId in totalRewards) {
    usersArray.push({
      id: userId,
      deposits: '0',
      rewards: totalRewards[userId]
    })
  }

  return usersArray
}

const main = async () => {
  let currentBlock = await web3.eth.getBlockNumber() - 1
  const toBlock = currentBlock
  const fromBlock = currentBlock - 1000
  const batchBlocks = 3600 / 15 // Once per hour

  let totalRewards = await recalculate(fromBlock, toBlock, batchBlocks)

  setInterval(async () => {
    totalRewards = await recalculate(fromBlock, toBlock, batchBlocks)
  }, 1000 * 3600) // Rerun once per hour

  // Server
  const { ApolloServer, gql } = require('apollo-server')

  const typeDefs = gql`
    type User {
      id: ID!
      deposits: String
      rewards: String
    }
    type Query {
      users: [User]
    }
    type Query {
      user(id: ID!): User
    }
  `

  const resolvers = {
    Query: {
      users: () => totalRewards,
      user(parent, args, context, info) {
        return totalRewards.find(user => user.id === args.id);
      }  
    },
  }

  const server = new ApolloServer({ typeDefs, resolvers });

  await server.listen().then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  })

}

main()
  .catch(console.error)
