"""Per-session primary inference usage and list-price cost estimates.

Prices are USD per token from the authenticated Nebius verbose model catalog,
retrieved 2026-10-25. Completion tokens already include reasoning tokens.
Unknown usage/pricing remains explicitly incomplete, including cancelled calls.
"""
from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Any

PRICING_SOURCE = "https://api.tokenfactory.nebius.com/v1/models?verbose=true"
PRICING_AS_OF = "2026-10-25"
# prompt, completion, cached prompt, in USD per token (not per million).
PRICES = {
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": ("0.00000006", "0.00000024", None),
    "nvidia/Nemotron-3_5-Lightning": ("0.00000006", "0.00000024", None),
    "nvidia/Nemotron-3-Ultra-550b-a55b": ("0.000001", "0.000003", "0.00000012"),
    "nvidia/nemotron-3-super-120b-a12b": ("0.0000003", "0.0000009", "0.00000006"),
    "nvidia/Nemotron-3.5-Super-VL": ("0.0000003", "0.0000009", "0.00000006"),
}


def _integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    try:
        return int(value) if int(value) == value else None
    except (OverflowError, ValueError):
        return None


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    index = (len(values) - 1) * fraction
    lower = int(index)
    upper = min(lower + 1, len(values) - 1)
    return round(values[lower] + (values[upper] - values[lower]) * (index - lower), 3)


class LLMUsage:
    """Collect metadata only; no prompts, completions, keys, or reasoning text."""
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.fallbacks: Counter[str] = Counter()

    def record(self, event: dict[str, Any]) -> None:
        if event.get("kind") == "request":
            self.requests.append(dict(event))
        elif event.get("kind") == "fallback":
            self.fallbacks[str(event.get("tier", "fast"))] += 1

    def _stats(self, requests: list[dict[str, Any]], fallbacks: int) -> dict[str, Any]:
        inputs = outputs = cached = reasoning = missing = unpriced = 0
        known_cost = Decimal(0)
        for record in requests:
            usage = record.get("usage") or {}
            inp = _integer(usage.get("prompt_tokens"))
            out = _integer(usage.get("completion_tokens"))
            cache_value = (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
            if cache_value is None:
                cache_value = usage.get("prompt_cache_hit_tokens")
            hit = _integer(cache_value)
            reason = _integer((usage.get("completion_tokens_details") or {}).get("reasoning_tokens"))
            if inp is not None: inputs += inp
            if out is not None: outputs += out
            if hit is not None: cached += hit
            if reason is not None: reasoning += reason
            if inp is None or out is None:
                missing += 1
                continue
            prices = PRICES.get(record.get("model")) if record.get("provider") == "nebius" else None
            if prices is None or (hit is not None and hit > inp):
                unpriced += 1
                continue
            # Missing cache details can change the bill when a discount exists.
            if hit is None and prices[2] is not None:
                unpriced += 1
                continue
            hit = hit or 0
            known_cost += Decimal(inp - hit) * Decimal(prices[0]) + Decimal(out) * Decimal(prices[1])
            if hit:
                # Nebius bills regular input price when no cached-input price is published.
                known_cost += Decimal(hit) * Decimal(prices[2] or prices[0])
        latencies = [float(r["latency_seconds"]) * 1000 for r in requests if isinstance(r.get("latency_seconds"), (int, float))]
        return {
            "calls": len(requests),
            "successes": sum(r.get("outcome") == "success" for r in requests),
            "errors": sum(r.get("outcome") == "error" for r in requests),
            "cancelled": sum(r.get("outcome") == "cancelled" for r in requests),
            "models": sorted({str(r.get("model")) for r in requests}),
            "roles": dict(Counter(str(r.get("role")) for r in requests)),
            "input_tokens": inputs, "cached_input_tokens": cached,
            "output_tokens": outputs, "reasoning_tokens": reasoning,
            "fallbacks": fallbacks, "usage_missing_calls": missing, "unpriced_calls": unpriced,
            "p50_latency_ms": _percentile(latencies, .5), "p95_latency_ms": _percentile(latencies, .95),
            "known_cost_usd": round(float(known_cost), 8),
            "cost_usd": None if missing or unpriced else round(float(known_cost), 8),
        }

    def snapshot(self) -> dict[str, Any]:
        tiers = sorted({"fast", "reasoning", *self.fallbacks, *(str(r.get("tier")) for r in self.requests)})
        return {
            "currency": "USD", "scope": "Nebius inference only, at list prices; excludes voice and hosting",
            "pricing_as_of": PRICING_AS_OF, "pricing_source": PRICING_SOURCE,
            "tiers": {tier: self._stats([r for r in self.requests if r.get("tier") == tier], self.fallbacks[tier]) for tier in tiers},
            "totals": self._stats(self.requests, sum(self.fallbacks.values())),
        }
