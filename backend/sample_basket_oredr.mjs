#!/usr/bin/env node
/**
 * Using OpenAlgo REST API endpoint: /api/v1/basketorder
 * Exchange: NFO
 * Product: NRML (Carry Forward)
 */

// const axios = require("axios");
import axios from 'axios';

// Replace with your actual OpenAlgo API key
const API_KEY = "af36ff8c7279c60b63a1d481c22d649a61befca94eed3241f8d935bbefcc980c";
const API_URL = "http://marketnext.in:5000/api/v1/basketorder";

// Strategy Metadata
const STRATEGY_NAME = "nifty_positional";

// Define Tuesday expiry (NIFTY weekly expiry)
const expiryDate = "14OCT25";
const lowerStrike = 25500;
const higherStrike = 25700;

// NIFTY Lot Size (as per OpenAlgo constants)
const LOT_SIZE = 75;

// Build standardized OpenAlgo option symbols
const symbolCEBuy = `NIFTY${expiryDate}${lowerStrike}CE`;   // Long Call
const symbolCESell = `NIFTY${expiryDate}${higherStrike}CE`; // Short Call

// Construct basket order payload
const basketPayload = {
  "apikey": API_KEY,
  "strategy": STRATEGY_NAME,
  orders: [
    {
      symbol: symbolCEBuy,
      exchange: "NFO",
      action: "BUY",
      quantity: LOT_SIZE,
      pricetype: "MARKET",
      product: "NRML", // Positional
    },
    {
      symbol: symbolCESell,
      exchange: "NFO",
      action: "SELL",
      quantity: LOT_SIZE,
      pricetype: "MARKET",
      product: "NRML",
    },
  ],
};

// Async function to place basket order
(async () => {
  console.log(" OpenAlgo Node.js Bot is running...");
  console.log(` Sending Basket Order to ${API_URL}`);
  console.log(` Payload is ${basketPayload}`);

  try {
    const response = await axios.post(API_URL, basketPayload, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log(" Basket Order Response:");
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error(" Error placing basket order:");
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
})();

