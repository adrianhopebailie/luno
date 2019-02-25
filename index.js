const luno = require('./luno')
const amount = process.argv[2] || '500000'
const slippage = process.argv[3] || '1'
const BigNumber = require('bignumber.js')
luno.getBtcRequiredForZar(new BigNumber(amount).times(new BigNumber(slippage))).catch(e => console.error(e))
