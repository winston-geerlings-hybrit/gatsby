const { performance } = require(`perf_hooks`)

const nodeFetch = require(`node-fetch`)
const uuidv4 = require(`uuid/v4`)

const bootstrapTime = performance.now()

const BENCHMARK_API_ENDPOINT =
  process.env.BENCHMARK_REPORTING_URL === "cli"
    ? undefined
    : process.env.BENCHMARK_REPORTING_URL

class BenchMeta {
  constructor() {
    this.flushing = undefined // Promise of flushing if that has started
    this.flushed = false // Completed flushing?
    this.localTime = new Date().toISOString()
    this.events = {
      // TODO: we should also have access to node's timing data and see how long it took before bootstrapping this script
      bootstrapTime, // Start of this file
      instanceTime: performance.now(), // Instantiation time of this class
      start: 0, // Start of benchmark itself
      stop: 0, // End of benchmark itself
    }
    this.started = false
  }

  getData() {
    return {
      time: this.localTime,
      sessionId: uuidv4(),
      events: JSON.stringify(this.events),
    }
  }

  markStart() {
    if (this.started) {
      api.reporter.error(
        "gatsby-plugin-benchmark-reporting: ",
        "Error: Should not call markStart() more than once"
      )
      process.exit(1)
    }
    this.events.start = performance.now()
    this.started = true
  }

  markDataPoint(name) {
    this.events[name] = performance.now()
  }

  async markStop() {
    if (!this.events.start) {
      api.reporter.error(
        "gatsby-plugin-benchmark-reporting:",
        "Error: Should not call markStop() before calling markStart()"
      )
      process.exit(1)
    }
    this.events.stop = performance.now()
    return this.flush()
  }

  async flush() {
    const data = this.getData()

    if (BENCHMARK_API_ENDPOINT) {
      api.reporter.info("Flushing benchmark data to remote server...")

      this.flushing = nodeFetch(`${BENCHMARK_API_ENDPOINT}`, {
        method: `POST`,
        headers: {
          "content-type": `application/json`,
          // "user-agent": this.getUserAgent(),
        },
        body: JSON.stringify(data),
      }).then(res => {
        this.flushed = true
        // Note: res.text returns a promise
        return res.text()
      })

      this.flushing.then(text => api.reporter.info("Server response:", text))

      return this.flushing
    }

    // ENV var had no reporting end point. Dump to CLI

    this.flushing = Promise.resolve()
    api.reporter.info("Benchmarking data:")
    api.reporter.info(data)
    this.flushed = true
  }
}

process.on(`exit`, async () => {
  if (!benchMeta.flushing) {
    api.reporter.error(
      "gatsby-plugin-benchmark-reporting: This is process.exit(); Not yet flushed, will flush now but it's probably too late..."
    )
    benchMeta.markDataPoint("post-build")
    let promise = benchMeta.markStop()
    promise.then(() => {
      // exit non-zero because node should exit _after_ submission
      process.exit(1)
    })
    return promise
  } else if (!benchMeta.flushed) {
    // Started to flush but the completion promise did not fire yet
    // This should't happen unless the reporting crashed hard
    benchMeta.flushing.then(() => {
      // Try to wait for current flush to finish, then exit non-zero (just in case that's not already happening)
      process.exit(1)
    })
    return benchMeta.flushing
  }
})

const benchMeta = BENCHMARK_API_ENDPOINT && new BenchMeta()

async function onPreInit(api) {
  // This should be set in the gatsby-config of the site when enabling this plugin
  api.reporter.info(
    "gatsby-plugin-benchmark-reporting: Will post benchmark data to",
    BENCHMARK_API_ENDPOINT ?? "the CLI"
  )

  benchMeta.markStart()
  benchMeta.markDataPoint("pre-init")
}

async function onPreBootstrap(...args) {
  benchMeta.markDataPoint("pre-bootstrap")
}

async function onPreBuild(...args) {
  benchMeta.markDataPoint("pre-build")
}

async function onPostBuild(api, options) {
  benchMeta.markDataPoint("post-build")
  return benchMeta.markStop(options)
}

module.exports = { onPreInit, onPreBootstrap, onPreBuild, onPostBuild }
