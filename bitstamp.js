const https = require('https')
const { table } = require('table')
const BigNumber = require('bignumber.js')

BigNumber.config({ DECIMAL_PLACES: 8 })

const BITSTAMP_XRP_RECEIVE_FEE = 0
const BITSTAMP_BTC_WITHDRAW_FEE = 0
const BITSTAMP_TAKER_FEE = process.env.BITSTAMP_TAKER_FEE || 0.0025

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

function sell(data, { xrp, rate, fee, received, totalXrpSold, totalBtcReceivedAfterTakerFee }) {

  data.push([
    xrp.dp(8, BigNumber.ROUND_DOWN).toString() + ' XRP',
    rate.dp(8, BigNumber.ROUND_DOWN).toString() + ' BTC',
    fee.dp(8, BigNumber.ROUND_UP).toString() + ' BTC',
    received.dp(8, BigNumber.ROUND_UP).toString() + ' BTC',
    totalXrpSold.dp(8, BigNumber.ROUND_UP).toString() + ' XRP',
    totalBtcReceivedAfterTakerFee.dp(2, BigNumber.ROUND_DOWN).toString() + ' BTC'
  ])

}

async function getXrpRequiredForBtc(btcRequired) {

  let totalXrpSold = new BigNumber(0);
  let totalBtcReceivedAfterTakerFee = new BigNumber(0);
  let btcRequiredBeforeWithdrawalFee = btcRequired.plus(BITSTAMP_BTC_WITHDRAW_FEE)

  console.log(`To withdraw ${btcRequired} BTC, ${btcRequiredBeforeWithdrawalFee} must be earned to accommodate ${BITSTAMP_BTC_WITHDRAW_FEE} withdrawal fee.`)

  console.log(`Getting order book...`)
  const orderBook = await getOrderBook()
  console.log(`Got order book ${orderBook.timestamp}`)

  const sales = [[
    'Sell', 'Rate', 'Fee', 'To Receive', 'Sold', 'Received'
  ]]
  console.log(`Calculating required sales...`)

  for (let i = 0; i < orderBook.bids.length && totalBtcReceivedAfterTakerFee.isLessThan(btcRequiredBeforeWithdrawalFee); i++) {

    const rate = new BigNumber(orderBook.bids[i][0])
    const bidXrpToSell = new BigNumber(orderBook.bids[i][1])
    const btcFromBid = rate.times(bidXrpToSell)
    const feeFromBid = btcFromBid.times(BITSTAMP_TAKER_FEE)
    const btcFromBidAfterTakerFee = (btcFromBid.minus(feeFromBid)).dp(8, BigNumber.ROUND_DOWN)

    const btcStillRequired = btcRequiredBeforeWithdrawalFee.minus(totalBtcReceivedAfterTakerFee)

    if(btcStillRequired.isLessThan(btcFromBidAfterTakerFee)) {

      //Consume part of bid
      const ratioOfBidToConsume = btcStillRequired.dividedBy(btcFromBidAfterTakerFee)
      const adjustedXrpSoldForBid = ratioOfBidToConsume.times(bidXrpToSell).dp(8, BigNumber.ROUND_UP)
      const adjustedBtcReceivedInBid = rate.times(adjustedXrpSoldForBid)
      const fee = adjustedBtcReceivedInBid.times(BITSTAMP_TAKER_FEE).dp(8, BigNumber.ROUND_UP)
      const adjustedBtcReceivedInBidAfterTakerFee = adjustedBtcReceivedInBid.minus(fee).dp(8, BigNumber.ROUND_DOWN)

      totalXrpSold = totalXrpSold.plus(adjustedXrpSoldForBid)

      // We may be out by a fraction of a cent due to rounding so make sure we don't loop again
      totalBtcReceivedAfterTakerFee = totalBtcReceivedAfterTakerFee.plus(btcStillRequired)
      
      sell(sales, {
        xrp: adjustedXrpSoldForBid, 
        rate, 
        fee,
        received: adjustedBtcReceivedInBidAfterTakerFee, 
        totalXrpSold: totalXrpSold, 
        totalBtcReceivedAfterTakerFee: totalBtcReceivedAfterTakerFee
      })
    } else {
      //Consume whole bid and reduce BTC available to sell
      const btcReceivedInBid = rate.times(bidXrpToSell)
      const fee = btcReceivedInBid.times(BITSTAMP_TAKER_FEE).dp(8, BigNumber.ROUND_UP)
      const btcReceivedInBidAfterTakerFee = btcReceivedInBid.minus(fee).dp(8, BigNumber.ROUND_DOWN)

      totalXrpSold = totalXrpSold.plus(bidXrpToSell)
      totalBtcReceivedAfterTakerFee = totalBtcReceivedAfterTakerFee.plus(btcReceivedInBidAfterTakerFee)

      sell(sales, {
        xrp: bidXrpToSell, 
        rate, 
        fee,
        received: btcReceivedInBidAfterTakerFee, 
        totalXrpSold: totalXrpSold, 
        totalBtcReceivedAfterTakerFee: totalBtcReceivedAfterTakerFee
      })
    }
  }
  console.log(table(sales, tableConfig))
  console.log(`A DEPOSIT of ${totalXrpSold.plus(BITSTAMP_XRP_RECEIVE_FEE)} XRP is required.`)
  console.log(` - A fee of ${BITSTAMP_XRP_RECEIVE_FEE} will be deducted leaving ${totalXrpSold} XRP to sell`)
  console.log(` - This will earn ${totalBtcReceivedAfterTakerFee} BTC after paying a fee of ${BITSTAMP_TAKER_FEE} per tx.`)
  console.log(`A WITHDRAWAL of ${btcRequired} BTC can then be made after the withdrawal fee`)
  return totalXrpSold.plus(BITSTAMP_XRP_RECEIVE_FEE)
}

async function getOrderBook () {
  return new Promise((resolve, reject) => {
    const req = https.request({
      headers: {
        'Accept': 'application/json',
        'Accept-Charset': 'utf-8'
      },
      hostname: 'www.bitstamp.net',
      path: '/api/v2/order_book/xrpbtc/',
      port: 443,
      method: 'GET'
    })
    req.on('response', function (res) {
      let response = ''
      res.setEncoding('utf8')
      res.on('data', function (data) {
        response += data
      })
      res.on('end', function () {
        if (res.statusCode !== 200) {
          return reject(new Error('Luno error ' + res.statusCode + ': ' + response))
        }
        try {
          response = JSON.parse(response)
        } catch (err) {
          return reject(err)
        }
        if (response.error) {
          return reject(new Error(response.error))
        }
        return resolve(response)
      })
    })  
    req.on('error', function (err) {
      reject(err)
    })  
    req.end()
  })
}

module.exports.getXrpRequiredForBtc = getXrpRequiredForBtc