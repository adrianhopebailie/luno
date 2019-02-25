const { table } = require('table')
const BigNumber = require('bignumber.js')
const debug = require('debug')('luno')
const BitX = require('./bitx-async.js')

BigNumber.config({ DECIMAL_PLACES: 8 })

const LUNO_KEY = process.env.LUNO_KEY || "bd6vcxud3euma"
const LUNO_SECRET = process.env.LUNO_SECRET || "bzZrd__HPdKSTZK6Xim0ZMzZb4GnszeO7nxt81lxb0Y"
const LUNO_BTC_RECEIVE_FEE = 0.00002
const LUNO_ZAR_WITHDRAW_FEE = 8.50
const LUNO_TAKER_FEE = process.env.LUNO_TAKER_FEE || 0.0075
const lunoClient = new BitX(LUNO_KEY, LUNO_SECRET)

const tableConfig = {
  columns: {
    0: {
      alignment: 'right',
      minWidth: 10
    },
    1: {
      alignment: 'right',
      minWidth: 8
    },
    2: {
      alignment: 'right',
      minWidth: 8
    },
    3: {
      alignment: 'right',
      minWidth: 10
    },
    4: {
      alignment: 'right',
      minWidth: 12
    },
    5: {
      alignment: 'right',
      minWidth: 12
    },
  }
};

function sell(data, { btc, rate, fee, received, totalBtcSold, totalZarReceivedAfterTakerFee }) {

  data.push([
    btc.dp(8, BigNumber.ROUND_DOWN).toString() + ' BTC',
    rate.dp(2, BigNumber.ROUND_DOWN).toString() + ' ZAR',
    fee.dp(2, BigNumber.ROUND_UP).toString() + ' ZAR',
    received.dp(2, BigNumber.ROUND_UP).toString() + ' ZAR',
    totalBtcSold.dp(8, BigNumber.ROUND_UP).toString() + ' BTC',
    totalZarReceivedAfterTakerFee.dp(2, BigNumber.ROUND_DOWN).toString() + ' ZAR'
  ])

}

async function getBtcRequiredForZar(zarRequired) {

  let totalBtcSold = new BigNumber(0);
  let totalZarReceivedAfterTakerFee = new BigNumber(0);
  let zarRequiredBeforeWithdrawalFee = zarRequired.plus(LUNO_ZAR_WITHDRAW_FEE)

  console.log(`-> To withdraw ${zarRequired} ZAR, ${zarRequiredBeforeWithdrawalFee} must be earned to accommodate ${LUNO_ZAR_WITHDRAW_FEE} withdrawal fee.`)

  console.log(`Getting order book...`)
  const orderBook = await lunoClient.getOrderBook()
  console.log(`Got order book ${orderBook.timestamp}`)

  const sales = [[
    'Sell', 'Rate', 'Fee', 'To Receive', 'Sold', 'Received'
  ]]
  console.log(`Calculating required sales...`)

  for (let i = 0; i < orderBook.bids.length && totalZarReceivedAfterTakerFee.isLessThan(zarRequiredBeforeWithdrawalFee); i++) {

    const rate = new BigNumber(orderBook.bids[i]['price'])
    const bidBtcToSell = new BigNumber(orderBook.bids[i]['volume'])
    const zarFromBid = rate.times(bidBtcToSell)
    const feeFromBid = zarFromBid.times(LUNO_TAKER_FEE)
    const zarFromBidAfterTakerFee = (zarFromBid.minus(feeFromBid)).dp(2, BigNumber.ROUND_DOWN)

    const zarStillRequired = zarRequiredBeforeWithdrawalFee.minus(totalZarReceivedAfterTakerFee)

    if(zarStillRequired.isLessThan(zarFromBidAfterTakerFee)) {

      //Consume part of bid
      const ratioOfBidToConsume = zarStillRequired.dividedBy(zarFromBidAfterTakerFee)
      const adjustedBtcSoldForBid = ratioOfBidToConsume.times(bidBtcToSell).dp(8, BigNumber.ROUND_UP)
      const adjustedZarReceivedInBid = rate.times(adjustedBtcSoldForBid)
      const fee = adjustedZarReceivedInBid.times(LUNO_TAKER_FEE).dp(2, BigNumber.ROUND_UP)
      const adjustedZarReceivedInBidAfterTakerFee = adjustedZarReceivedInBid.minus(fee).dp(2, BigNumber.ROUND_DOWN)

      totalBtcSold = totalBtcSold.plus(adjustedBtcSoldForBid)

      // We may be out by a fraction of a cent due to rounding so make sure we don't loop again
      totalZarReceivedAfterTakerFee = totalZarReceivedAfterTakerFee.plus(zarStillRequired)
      
      sell(sales, {
        btc: adjustedBtcSoldForBid, 
        rate, 
        fee,
        received: adjustedZarReceivedInBidAfterTakerFee, 
        totalBtcSold, 
        totalZarReceivedAfterTakerFee
      })
    } else {
      //Consume whole bid and reduce BTC available to sell
      const zarReceivedInBid = rate.times(bidBtcToSell)
      const fee = zarReceivedInBid.times(LUNO_TAKER_FEE).dp(2, BigNumber.ROUND_UP)
      const zarReceivedInBidAfterTakerFee = zarReceivedInBid.minus(fee).dp(2, BigNumber.ROUND_DOWN)

      totalBtcSold = totalBtcSold.plus(bidBtcToSell)
      totalZarReceivedAfterTakerFee = totalZarReceivedAfterTakerFee.plus(zarReceivedInBidAfterTakerFee)

      sell(sales, {
        btc: bidBtcToSell, 
        rate, 
        fee,
        received: zarReceivedInBidAfterTakerFee, 
        totalBtcSold, 
        totalZarReceivedAfterTakerFee
      })
    }
  }
  console.log(table(sales, tableConfig))
  console.log(`A DEPOSIT of ${totalBtcSold.plus(LUNO_BTC_RECEIVE_FEE)} BTC is required.`)
  console.log(` - A fee of ${LUNO_BTC_RECEIVE_FEE} will be deducted leaving ${totalBtcSold} BTC to sell`)
  console.log(` - This will earn ${totalZarReceivedAfterTakerFee} ZAR after paying a fee of ${LUNO_TAKER_FEE} per tx.`)
  console.log(`A WITHDRAWAL of ${zarRequired} ZAR can then be made after the withdrawal fee`)
  return totalBtcSold.plus(LUNO_BTC_RECEIVE_FEE)
}

module.exports.getBtcRequiredForZar = getBtcRequiredForZar