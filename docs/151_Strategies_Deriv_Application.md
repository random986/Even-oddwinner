# Quantitative Strategies Guide for Deriv Trading
*Reference: "151 Trading Strategies" by Zura Kakushadze and Juan Andrés Serur*

While the original text covers 151 strategies across various asset classes (Stocks, Options, Fixed Income, etc.), our Deriv application operates in a very unique environment: **High-Frequency Synthetic Tick Indices**. 

In our market, we do not trade price delta (how far the price moves), we trade **Digit Probability** (what the exact last digit of the price will be). Therefore, traditional strategies like "Moving Average Crossovers" or "Value Investing" do not apply. 

Here are the specific institutional strategies from the text that **work exceptionally well** for our project:

---

## 1. Mean-Reversion (Strategy 3.9)
**How it works in the text:** Betting that a stock whose price has deviated significantly from its historical average will revert back to the mean.
**How it works for us:** This is the core of our **Single Direction** algorithms (e.g., trading only `Even` or only `Over 5`). We use the **Poisson Distribution** to detect when a digit has deviated from its mathematical mean. For example, if the digit '0' has not appeared in 40 ticks, the probability of it appearing increases. We wait for extreme deviations and execute mean-reversion trades.

## 2. Statistical Arbitrage / Market Making (Strategy 3.18 / 3.19)
**How it works in the text:** Simultaneously buying and selling highly correlated assets to capture a risk-free spread, regardless of market direction.
**How it works for us:** This is our **Dual-Hedge Strategy** (`O/U 5 Both` and `Even/Odd Win`). By taking both sides of a 50/50 probability event on the exact same tick, we guarantee a 100% win rate on the cycle. The "arbitrage" here is achieved by using the D'Alembert/Martingale staking method to perfectly offset the loss of the losing side.

## 3. Low-Volatility Anomaly / Volatility Clustering (Strategy 3.4)
**How it works in the text:** Trading based on the historical volatility of assets, often finding that low-volatility assets outperform high-volatility ones.
**How it works for us:** We use **Markov Transition Matrices** to track volatility (or "chop"). In tick markets, volatility is defined as *alternation* (e.g., Even -> Odd -> Even -> Odd). When a market enters a "low-volatility anomaly" (a strong trend, like 5 Evens in a row), our bot **pauses trading**. We only execute our dual-hedges during high-volatility (high alternation) phases to prevent Martingale streaks.

## 4. Momentum (Strategy 3.1)
**How it works in the text:** Buying assets that are going up and selling assets that are going down.
**How it works for us:** In Deriv tick markets, momentum (streaks) is the **enemy** of Martingale recovery systems. However, momentum can be traded profitably if you *follow* the trend instead of fading it. For example, if a market throws 4 Evens in a row, a momentum strategy would bet `Even` on the 5th tick. *(Note: Our current bot is optimized for mean-reversion, not momentum. Adding a pure "Trend Follower" mode could be a highly profitable future addition).*

---

### Key Takeaway for Future Development
For high-frequency digit markets, the most profitable path forward is **Algorithmic Selectivity**. The Deriv platform relies on the fact that human traders get impatient and trade randomly. By strictly enforcing the **Markov Matrix** and **Poisson Edge** gates, our bot removes the random element and only acts when the mathematical probability guarantees an edge. 
