const {db, config, blockchain} = require('../context')
const {exceptions: {NotFoundError, InvalidStateError}} = require('@welldone-software/node-toolbelt')
const {errors: {errSerializer}} = require('stox-common')
const {Big} = require('big.js')

const createTransaction = ({id, type, from}) => db.transactions.create({id, type, from})

const isResendTransaction = transaction => transaction.originalTransactionId

const getTransaction = async (query) => {
  const transaction = await db.transactions.findOne({where: query})
  if (!transaction) {
    throw new NotFoundError('transactionNotFound', query)
  }

  return transaction
}

const validateTransactionForResend = (transaction) => {
  const throwError = (msg) => {
    throw new InvalidStateError(msg)
  }
  return transaction.error ? throwError('transactionError')
    : transaction.completedAt ? throwError('transactionCompleted')
      : !transaction.sentAt ? throwError('transactionNotSentYet')
        : transaction.resentAt ? throwError('transactionAlreadyResent')
          : transaction.canceledAt ? throwError('transactionCanceled') : true
}

const resendTransaction = async (transactionHash) => {
  const transaction = await getTransaction({transactionHash})
  validateTransactionForResend(transaction.dataValues)
  const dbTransaction = await db.sequelize.transaction()
  const {requestId, type, subRequestIndex, subRequestData, subRequestType,
    transactionData, network, from, to, nonce, gasPrice, originalTransactionId, id} = transaction.dataValues
  try {
    await transaction.update({resentAt: Date.now()}, {transaction: dbTransaction})
    await db.transactions.create(
      {requestId,
        type,
        subRequestIndex,
        subRequestData,
        subRequestType,
        transactionData,
        network,
        from,
        to,
        nonce,
        gasPrice,
        originalTransactionId: originalTransactionId || id},
      {transaction: dbTransaction}
    )
    await dbTransaction.commit()
  } catch (e) {
    dbTransaction.rollback()
    throw e
  }
}

const getPendingTransactionsGasPrice = async () => (await db.transactions.sum(
  'estimatedGasCost',
  {where: {estimatedGasCost: {$ne: null}, sentAt: {$ne: null}, resentAt: null, completedAt: null}}
)) || 0

const getPendingTransactions = limit => db.transactions.findAll({where: {sentAt: null, completedAt: null}, limit})

const getUnconfirmedTransactions = limit =>
  db.transactions.findAll({
    where: {
      sentAt: {
        $ne: null,
      },
      completedAt: null,
    },
    limit,
  })

const rejectRelatedTransactions = async ({id, transactionHash, nonce, from}, dbTransaction) => db.transactions.update(
  {error: {reason: 'transaction override', transactionId: id, transactionHash}, completedAt: Date.now()},
  {
    where: {
      id: {$ne: id},
      nonce,
      from,
    },
  },
  dbTransaction
)

const isSentWithGasPriceHigherThan = (from, nonce, gasPrice) =>
  db.transactions.findOne({where: {nonce, from, gasPrice: {$gt: gasPrice}}})

const updateCompletedTransaction = async (transactionInstance, {isSuccessful, blockTime, receipt}) => {
  const dbTransaction = await db.sequelize.transaction()
  try {
    await rejectRelatedTransactions(transactionInstance, dbTransaction)
    await transactionInstance.updateAttributes(
      {
        completedAt: Date.now(),
        receipt,
        currentBlockTime: blockTime,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
        error: isSuccessful ? null : {message: 'error in blockchain transaction'},
      },
      {
        transaction: dbTransaction,
      }
    )
    await dbTransaction.commit()

    return transactionInstance.dataValues
  } catch (e) {
    dbTransaction.rollback()
    throw e
  }
}

const addTransactions = async (requestId, transactions) => {
  const dbTransaction = await db.sequelize.transaction()

  try {
    await db.transactions.bulkCreate(transactions, {transaction: dbTransaction})
    await db.requests.update(
      {transactionPreparedAt: Date.now()},
      {where: {id: requestId}}, {transaction: dbTransaction}
    )
    await dbTransaction.commit()
  } catch (error) {
    dbTransaction.rollback()
    throw error
  }
}

const updateTransactionError = (id, error) =>
  db.transactions.update({error: errSerializer(error), completedAt: Date.now()}, {where: {id}})

const isTransactionConfirmed = completedTransaction =>
  completedTransaction && completedTransaction.confirmations >= Number(config.requiredConfirmations)

const isMinedTransactionInDb = async ({requestId, from, nonce}) => {
  const relatedTransaction = await db.transactions.findAll({where: {requestId, from, nonce}})
  return (await Promise.all(relatedTransaction.map(async transaction =>
    transaction.transactionHash && blockchain.web3.eth.getTransactionReceipt(transaction.transactionHash))))
    .filter(transaction => transaction)
}

const isAlreadyMined = async ({from, nonce}) => {
  const transactionsCount = await blockchain.web3.eth.getTransactionCount(from)
  return Big(transactionsCount).gt(nonce)
}

module.exports = {
  getTransaction,
  createTransaction,
  getPendingTransactions,
  getUnconfirmedTransactions,
  updateCompletedTransaction,
  addTransactions,
  resendTransaction,
  updateTransactionError,
  isTransactionConfirmed,
  isResendTransaction,
  isSentWithGasPriceHigherThan,
  isAlreadyMined,
  isMinedTransactionInDb,
  getPendingTransactionsGasPrice,
}
