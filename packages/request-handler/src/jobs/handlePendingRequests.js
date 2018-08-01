const {context, services: {requests}, utils: {loggerFormatText}} = require('stox-bc-request-manager-common')
const {errors: {logError}} = require('stox-common')
const {handlePendingRequestCron, limitPendingRequest} = require('../config')
const promiseSerial = require('promise-serial')
const {handleRequest} = require('../services/requestHandler')

module.exports = {
  cron: handlePendingRequestCron,
  job: async () => {
    const pendingRequests = await requests.getPendingRequests(limitPendingRequest)

    context.logger.info({count: pendingRequests.length}, 'PENDING_REQUESTS')

    try {
      const funcs = pendingRequests.map(request => async () => {
        const {id, type} = request

        try {
          await handleRequest(request)
          context.logger.info({request: request.dataValues}, loggerFormatText(type))
        } catch (e) {
          if (e.code === 502 || e.reason === 'bcNodeError') {
            logError(e, 'CONNECTION_ERROR')
          } else {
            logError(e, `${loggerFormatText(type)}_HANDLER_ERROR`)
            await requests.updateRequestCompleted(id, e)
            await requests.publishCompletedRequest(await requests.getRequestById(id, {withTransactions: true}))
          }
        }
      })
      await promiseSerial(funcs)
    } catch (e) {
      logError(e)
    }
  },
}
