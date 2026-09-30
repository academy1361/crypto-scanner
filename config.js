window.SCANNER_CONFIG = {
  spotBase: "https://api.binance.com/api/v3",
  futuresBase: "https://fapi.binance.com/fapi/v1",
  symbols: [
    "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT",
    "TRXUSDT","TONUSDT","SUIUSDT","LTCUSDT","BCHUSDT","NEARUSDT","APTUSDT","ICPUSDT","FILUSDT","ARBUSDT",
    "OPUSDT","ATOMUSDT","INJUSDT","ETCUSDT","AAVEUSDT","UNIUSDT","XLMUSDT","HBARUSDT","MATICUSDT","SEIUSDT"
  ],
  refreshMs: 300000,
  journalApi: "",
  journalApiKey: "",
  weights: { mtf:18, compression:12, volume:14, oi:12, book:12, breakout:10, momentum:8, funding:4, btc:5, liquidity:5 }
};