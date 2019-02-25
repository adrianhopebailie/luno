const luno = require('./luno')
const bitstamp = require('./bitstamp')
const amount = process.argv[2] || '500000'
const slippage = process.argv[3] || '1'
const BigNumber = require('bignumber.js')

const run = async () => {
  console.log('Calculating required BTC deposit at Luno')
  const btc = await luno.getBtcRequiredForZar(new BigNumber(amount).times(new BigNumber(slippage)))
  console.log('')
  console.log('Calculating required XRP deposit at Bitstamp')
  await bitstamp.getXrpRequiredForBtc(btc)
}

run().catch(e => console.error(e))
