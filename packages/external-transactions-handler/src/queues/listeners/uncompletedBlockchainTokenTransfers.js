const {context: {db, mq}} = require('stox-bc-request-manager-common')
const {errors: {logError}} = require('stox-common')

const getType = (to, message, transactionFromDb) => {
  switch (to) {
    case message.feesAccount: return 'withdraw-fee'
    case message.userWithdrawalAccount: return 'withdraw-completed'
    case message.walletAddress:
      return (transactionFromDb && transactionFromDb.request.type === 'sendPrize') ? 'prize' : 'deposit'
    default: return ''
  }
}
module.exports = async ({body: message}) => {
  try {
    const transactions = await Promise.all(message.transactions.map(async (transaction) => {
      const transactionFromDb = await db.transactions.findOne({
        where: {transactionHash: transaction.transactionHash},
        include: [{model: db.requests}],
      })
      const type = getType(transaction.to, message, transactionFromDb)
      return transactionFromDb ?
        {...transaction, requestId: transactionFromDb.requestId, type} :
        {...transaction, type}
    }))
    mq.publish('blockchain-token-transfers', {...message, transactions})
  } catch (e) {
    logError(e)
  }
}
