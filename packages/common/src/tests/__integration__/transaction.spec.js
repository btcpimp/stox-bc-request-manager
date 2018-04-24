const uuid4 = require('uuid4')
const {range} = require('lodash')
const {initContext, context, createService, models} = require('../../index')
const transactions = require('../../services/transactions')
const {databaseUrl, network} = require('../test_config')

describe('requests service sanity checks', () => {
  beforeAll(async (done) => {
    const builderFunc = builder => builder.db(databaseUrl, models)
    const ctx = await createService('request-handler-tests', builderFunc)
    initContext({...ctx}, context)
    done()
  })
  const type = 'createWallet'

  it('should return only pending request when calling getPendingTransactions', async () => {
    // prepare
    const requestsToAdd = range(0, 5).map(() => ({id: uuid4(), type, data: {}}))
    const transactionsToAdd = range(0, 4).map(i => ({
      id: uuid4(),
      requestId: requestsToAdd[i].id,
      type: 'send',
      from: 'from',
      network,
    }))
    transactionsToAdd.push({
      id: uuid4(),
      requestId: requestsToAdd[4].id,
      type: 'send',
      from: 'from',
      network,
      sentAt: new Date(),
    })

    await context.db.requests.bulkCreate(requestsToAdd)
    await context.db.transactions.bulkCreate(transactionsToAdd)

    // act
    const pendindTransaction1 = await transactions.getPendingTransactions(5)
    const pendindTransaction2 = await transactions.getPendingTransactions(2)

    // assert
    expect(pendindTransaction1).toHaveLength(4)
    expect(pendindTransaction2).toHaveLength(2)
  })

  it('should return only sent and uncompleted transaction when calling getUncompletedTransactions', async () => {
    // prepare
    const requestsToAdd = range(0, 5).map(() => ({id: uuid4(), type, data: {}}))
    const transactionsToAdd = range(0, 3).map(i => ({
      id: uuid4(),
      requestId: requestsToAdd[i].id,
      type: 'send',
      from: 'from',
      network,
      sentAt: new Date(),
    }))
    transactionsToAdd.push({
      id: uuid4(),
      requestId: requestsToAdd[3].id,
      type: 'send',
      from: 'from',
      network,
      sentAt: new Date(),
      completedAt: new Date(),
    })
    transactionsToAdd.push({id: uuid4(), requestId: requestsToAdd[4].id, type: 'send', from: 'from', network})
    await context.db.requests.bulkCreate(requestsToAdd)
    await context.db.transactions.bulkCreate(transactionsToAdd)

    // act
    const uncompletedTransaction1 = await transactions.getUncompletedTransactions(5)
    const uncompletedTransaction2 = await transactions.getUncompletedTransactions(2)

    // assert
    expect(uncompletedTransaction1).toHaveLength(3)
    expect(uncompletedTransaction2).toHaveLength(2)
  })

  it('should update successful transaction when calling updateCompletedTransaction with correct parameters ', async () => {
    // prepare
    const transactionHash = uuid4()
      .toString()
      .substring(0, 66)
    const requestToAdd = {id: uuid4(), type, data: {}}
    const transactionToAdd =
      {id: uuid4(), requestId: requestToAdd.id, type: 'send', from: 'from', network, transactionHash}


    await context.db.requests.create(requestToAdd)
    await context.db.transactions.create(transactionToAdd)

    // act
    await transactions.updateCompletedTransaction(transactionToAdd, {
      isSuccessful: true,
      blockTime: 1,
      receipt: {
        blockNumber: 1,
      },
    })

    const {dataValues: updatedTransaction } = await context.db.transactions.findOne({id: transactionToAdd})

    // assert
    expect(updatedTransaction.completedAt).toBeTruthy()
    expect(updatedTransaction.receipt).toBeTruthy()
    expect(updatedTransaction.currentBlockTime).toBeTruthy()
    expect(updatedTransaction.blockNumber).toBeTruthy()
    expect(updatedTransaction.error).toBeFalsy()
  })


  it('should add transaction to database and update corresponding request when calling addTransactions', async () => {
    // prepare
    const requestToAdd = {id: uuid4(), type, data: {}}
    const transactionsToAdd = range(0, 3).map(i => ({
      id: uuid4(),
      requestId: requestToAdd.id,
      type: 'send',
      from: 'from',
      network,
      sentAt: new Date(),
    }))
    await context.db.requests.create(requestToAdd)

    // act
    await transactions.addTransactions(requestToAdd.id,transactionsToAdd)
    const {dataValues: updatedRequest} = await context.db.requests.findOne({where: {id: requestToAdd.id}})
    const updatedTransactions = await context.db.transactions.findAll({requestId: requestToAdd.id})

    // assert
    expect(updatedTransactions).toHaveLength(3)
    expect(updatedRequest.transactionPreparedAt).toBeTruthy()

  })

  afterEach(async (done) => {
    await context.db.requests.destroy({where: {}})
    await context.db.transactions.destroy({where: {}})
    done()
  })
})
