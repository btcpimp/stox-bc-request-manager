const {exceptions: {UnexpectedError}} = require('@welldone-software/node-toolbelt')
const {writePendingTransactionsCron, transactionsSignerBaseUrl, limitTransactions} = require('../config')
const {http, errors: {logError}} = require('stox-common')
const promiseSerial = require('promise-serial')
const {
  services: {
    accounts: {fetchNextAccountNonce, findOrCreateAccountNonce},
    requests,
    transactions: {getPendingTransactions},
  },
  context,
  context: {db, blockchain},
} = require('stox-bc-request-manager-common')

const clientHttp = http(transactionsSignerBaseUrl)

const fetchNonceFromEtherNode = async fromAccount =>
  blockchain.web3.eth.getTransactionCount(fromAccount)

const isEtherNodeNonceSynced = async ({from, network}, dbTransaction) => {
  const nonceFromEtherNode = await fetchNonceFromEtherNode(from)
  const nonceFromAccountNonces = await fetchNextAccountNonce(from, network, dbTransaction)
  return [nonceFromAccountNonces >= nonceFromEtherNode, nonceFromEtherNode, nonceFromAccountNonces]
}

const fetchGasPriceFromGasCalculator = async () => '5000000000' // 5 Gwei

const signTransactionInTransactionSigner = async (from, unsignedTransaction, transactionId) => {
  const signedTransaction = await clientHttp.post('/transactions/sign', {from, unsignedTransaction, transactionId})
  context.logger.info({from, unsignedTransaction, signedTransaction, transactionId}, 'TRANSACTION_SIGNED')
  return signedTransaction
}

const sendTransactionToBlockchain = async signedTransaction => new Promise(((resolve) => {
  blockchain.web3.eth.sendSignedTransaction(signedTransaction)
    .once('transactionHash', (hash) => {
      context.logger.info({hash}, 'TRANSACTION_SENT')
      resolve(hash)
    })
    .on('error', (error) => {
      throw new UnexpectedError(error)
    })
}))

const updateTransaction = async (transaction, unsignedTransaction, transactionHash, dbTransaction) => {
  await transaction.update(
    {
      transactionHash,
      gasPrice: unsignedTransaction.gasPrice,
      nonce: unsignedTransaction.nonce,
      sentAt: Date.now(),
    },
    {transaction: dbTransaction}
  )
}

const updateRequest = async ({requestId}, dbTransaction) => {
  const request = await requests.getRequestById(requestId)
  await request.update({sentAt: Date.now()}, {transaction: dbTransaction})
}

const updateAccountNonce = async ({from, network}, nonce, dbTransaction) => {
  const accountNonce = await findOrCreateAccountNonce(from, network, dbTransaction)
  await accountNonce.update({nonce}, {transaction: dbTransaction})
}

module.exports = {
  cron: writePendingTransactionsCron,
  job: async () => {
    const pendingTransactions = await getPendingTransactions(limitTransactions)
    const dbTransaction = await db.sequelize.transaction()
    const promises = pendingTransactions.map(transaction => async () => {
      const [isNonceSynced, nodeNonce, dbNonce] = await isEtherNodeNonceSynced(transaction, dbTransaction)

      if (!isNonceSynced) {
        context.logger.warn({transactionId: transaction.id, nodeNonce, dbNonce}, 'NONCE_NOT_SYNCED')
        return
      }

      const unsignedTransaction = {
        nonce: nodeNonce,
        to: transaction.to,
        data: transaction.transactionData.toString(),
        gasPrice: await fetchGasPriceFromGasCalculator(),
        chainId: await blockchain.web3.eth.net.getId(),
      }

      unsignedTransaction.gasLimit = await blockchain.web3.eth.estimateGas({
        from: transaction.from,
        to: unsignedTransaction.to,
        gasPrice: unsignedTransaction.gasPrice,
        nonce: unsignedTransaction.nonce,
        data: unsignedTransaction.data,
      })

      const signedTransaction =
        await signTransactionInTransactionSigner(transaction.from, unsignedTransaction, transaction.id)
      const transactionHash = await sendTransactionToBlockchain(signedTransaction)

      await updateTransaction(transaction, unsignedTransaction, transactionHash, dbTransaction)
      await updateRequest(transaction, dbTransaction)
      await updateAccountNonce(transaction, nodeNonce, dbTransaction)

      context.logger.info({transaction}, 'SUCCESSFULLY_UPDATED_TRANSACTION')
    })

    try {
      await promiseSerial(promises)
      await dbTransaction.commit()
    } catch (e) {
      dbTransaction.rollback()
      logError(e)
    }
  },
}
