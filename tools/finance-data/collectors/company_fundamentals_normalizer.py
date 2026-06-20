from __future__ import annotations

import re
from typing import Any

from common import observation_fact, pct_change, to_float, unavailable_fact


COMPANY_FINANCIAL_ALLOWED_CLAIMS = [
    "earnings_transmission_proxy",
    "commodity_to_company_earnings",
    "company_quality_proxy",
    "profit_sensitivity",
    "valuation_proxy",
    "valuation_level",
    "risk_reward",
    "risk_reward_boundary",
    "equity_transmission_proxy",
    "limited_positive_stance",
    "limited_negative_stance",
]

COMPANY_FINANCIAL_NOT_ALLOWED_CLAIMS = [
    "company_earnings_confirmed",
    "product_margin_confirmed",
    "mine_output_confirmed",
    "cost_curve_confirmed",
    "trade_flow_confirmed",
    "full_industry_fundamentals_confirmed",
    "a_share_relative_allocation_confirmed",
]

TECHNICAL_TABLE_ALLOWED_CLAIMS = ["company_financial_table_available"]
TECHNICAL_TABLE_REQUIRED_KEYS = ["technical_company_financial_table_summary"]


METRIC_SPECS: dict[str, dict[str, Any]] = {
    "revenue": {
        "metricName": "company_revenue_proxy",
        "displayZh": "营业收入",
        "aliases": ["营业收入", "营业总收入", "主营业务收入"],
        "unit": "CNY",
        "requiredKeys": ["earnings_transmission_proxy"],
        "category": "income_statement",
    },
    "net_profit_parent": {
        "metricName": "company_net_profit_parent_proxy",
        "displayZh": "归母净利润",
        "aliases": ["归母净利润", "归属于母公司股东的净利润", "净利润"],
        "unit": "CNY",
        "requiredKeys": ["earnings_transmission_proxy"],
        "category": "income_statement",
    },
    "roe": {
        "metricName": "company_roe_proxy",
        "displayZh": "净资产收益率",
        "aliases": ["净资产收益率", "加权净资产收益率", "摊薄净资产收益率", "ROE"],
        "unit": "%",
        "requiredKeys": ["earnings_transmission_proxy", "risk_reward_boundary"],
        "category": "profitability",
    },
    "gross_margin": {
        "metricName": "company_gross_margin_proxy",
        "displayZh": "毛利率",
        "aliases": ["销售毛利率", "毛利率"],
        "unit": "%",
        "requiredKeys": ["earnings_transmission_proxy"],
        "category": "profitability",
    },
    "net_margin": {
        "metricName": "company_net_margin_proxy",
        "displayZh": "净利率",
        "aliases": ["销售净利率", "净利率"],
        "unit": "%",
        "requiredKeys": ["earnings_transmission_proxy"],
        "category": "profitability",
    },
    "debt_ratio": {
        "metricName": "company_debt_ratio_proxy",
        "displayZh": "资产负债率",
        "aliases": ["资产负债率"],
        "unit": "%",
        "requiredKeys": ["risk_reward_boundary"],
        "category": "balance_sheet_risk",
    },
    "operating_cashflow": {
        "metricName": "company_operating_cashflow_proxy",
        "displayZh": "经营现金流",
        "aliases": ["经营活动产生的现金流量净额", "经营活动现金流量净额", "经营现金流量净额", "经营性现金流", "经营现金流"],
        "unit": "CNY",
        "requiredKeys": ["risk_reward_boundary", "earnings_transmission_proxy"],
        "category": "cashflow",
    },
    "eps": {
        "metricName": "company_eps_proxy",
        "displayZh": "基本每股收益",
        "aliases": ["基本每股收益", "每股收益", "EPS"],
        "unit": "CNY/share",
        "requiredKeys": ["earnings_transmission_proxy", "valuation_proxy"],
        "category": "per_share",
    },
}

GROWTH_METRICS = {
    "revenue": "company_revenue_yoy_proxy",
    "net_profit_parent": "company_net_profit_parent_yoy_proxy",
}

_PERIOD_RE = re.compile(r"^(?:19|20)\d{6}$")


def financial_table_claim_boundary() -> dict[str, list[str]]:
    return {
        "allowedClaimTypes": TECHNICAL_TABLE_ALLOWED_CLAIMS,
        "requiredEvidenceKeys": TECHNICAL_TABLE_REQUIRED_KEYS,
    }


def _clean_text(value: Any) -> str:
    return str(value or "").strip().replace(" ", "").lower()


def _period_columns(row: dict[str, Any]) -> list[str]:
    return sorted([str(key) for key in row if _PERIOD_RE.match(str(key))], reverse=True)


def _matching_row(records: list[dict[str, Any]], aliases: list[str]) -> dict[str, Any] | None:
    clean_aliases = [_clean_text(alias) for alias in aliases]
    exact_matches: list[dict[str, Any]] = []
    contains_matches: list[dict[str, Any]] = []
    for row in records:
        metric = _clean_text(row.get("指标") or row.get("metric") or row.get("项目"))
        if not metric:
            continue
        if metric in clean_aliases:
            exact_matches.append(row)
            continue
        if any(alias and alias in metric for alias in clean_aliases):
            contains_matches.append(row)
    return exact_matches[0] if exact_matches else (contains_matches[0] if contains_matches else None)


def _latest_value(row: dict[str, Any]) -> tuple[str | None, float | None]:
    for period in _period_columns(row):
        value = to_float(row.get(period))
        if value is not None:
            return period, value
    return None, None


def _same_period_last_year(period: str | None) -> str | None:
    if not period or not _PERIOD_RE.match(period):
        return None
    year = int(period[:4]) - 1
    return f"{year}{period[4:]}"


def _source_unit_note(unit: str) -> str:
    if unit == "CNY":
        return "金额单位按 Sina Finance / AKShare 财务摘要原始口径记录，未重新审计。"
    if unit == "%":
        return "比例单位按 Sina Finance / AKShare 财务摘要原始口径记录。"
    return "单位按 Sina Finance / AKShare 财务摘要原始口径记录。"


def _company_policy_notes() -> list[str]:
    return [
        "AKShare 是访问入口，不是事实发布方。",
        "Sina Finance 财务摘要属于公开摘要口径，只能作为公司基本面代理事实。",
        "本事实不能替代正式年报、审计财报、分产品盈利和矿山产量明细。",
    ]


def _metric_fact(
    *,
    fact_id: str,
    company: dict[str, Any],
    endpoint: str,
    confidence: float,
    metric_key: str,
    spec: dict[str, Any],
    period: str,
    value: float,
) -> dict[str, Any]:
    unit = spec["unit"]
    return observation_fact(
        fact_id=fact_id,
        statement_zh=(
            f"Sina Finance 财务摘要显示 {company['name']}（{company['code']}）{spec['displayZh']}在 {period} "
            f"为 {value:g} {unit}。{_source_unit_note(unit)}该事实只能作为公司基本面代理，"
            "不能单独确认完整盈利改善、产品毛利或矿山产量。"
        ),
        metric_name=spec["metricName"],
        value=value,
        unit=unit,
        period=period,
        source="SINA_FINANCE",
        source_type="public_data_via_named_collector",
        source_publisher="Sina Finance",
        access_provider="AKShare",
        collector="akshare_python_package_v0",
        endpoint=endpoint,
        confidence=confidence,
        domain="company_financials",
        entity=company["code"],
        locator=f"{company['code']}:{metric_key}",
        original_location=f"akshare:{endpoint}:{company['code']}:{metric_key}:{period}",
        policy_notes=_company_policy_notes(),
        observed_at=period,
        transform=f"stock_financial_abstract row alias -> {metric_key}; latest non-empty reporting period",
        reliability_tier="public_data_via_named_collector",
        allowed_claim_types=COMPANY_FINANCIAL_ALLOWED_CLAIMS,
        not_allowed_claim_types=COMPANY_FINANCIAL_NOT_ALLOWED_CLAIMS,
        interpretation_hint="可支持盈利传导、公司质量或风险收益边界的有限判断；强结论需要正式财报和产业数据配合。",
        score_cap_policy="Sina Finance financial abstract facts are usable with cap and cannot confirm full company earnings or product margin claims.",
        frequency="quarterly_or_annual_reported_fields",
        required_evidence_keys=spec["requiredKeys"],
        extra={
            "companyName": company["name"],
            "primaryExposure": company.get("primaryExposure"),
            "bucket": company.get("bucket"),
            "companyMetricKey": metric_key,
            "companyMetricCategory": spec["category"],
            "sourceMetricAliases": spec["aliases"],
        },
    )


def _growth_fact(
    *,
    fact_id: str,
    company: dict[str, Any],
    endpoint: str,
    confidence: float,
    metric_key: str,
    display_zh: str,
    period: str,
    value: float,
    comparison_period: str,
    comparison_value: float,
) -> dict[str, Any] | None:
    growth = pct_change(value, comparison_value)
    if growth is None:
        return None
    return observation_fact(
        fact_id=fact_id,
        statement_zh=(
            f"Sina Finance 财务摘要显示 {company['name']}（{company['code']}）{display_zh}在 {period} "
            f"相对 {comparison_period} 约变化 {growth}%。该同比为公开摘要代理计算，"
            "不能单独确认完整盈利周期或分产品利润。"
        ),
        metric_name=GROWTH_METRICS[metric_key],
        value=growth,
        unit="%",
        period=f"{comparison_period}..{period}",
        source="SINA_FINANCE",
        source_type="public_data_via_named_collector",
        source_publisher="Sina Finance",
        access_provider="AKShare",
        collector="akshare_python_package_v0",
        endpoint=endpoint,
        confidence=confidence,
        domain="company_financials",
        entity=company["code"],
        locator=f"{company['code']}:{metric_key}:yoy",
        original_location=f"akshare:{endpoint}:{company['code']}:{metric_key}:{comparison_period}:{period}",
        policy_notes=_company_policy_notes(),
        observed_at=period,
        transform=f"pct_change({period}, {comparison_period}) from stock_financial_abstract row {metric_key}",
        reliability_tier="public_data_via_named_collector",
        allowed_claim_types=COMPANY_FINANCIAL_ALLOWED_CLAIMS,
        not_allowed_claim_types=COMPANY_FINANCIAL_NOT_ALLOWED_CLAIMS,
        interpretation_hint="可作为盈利或收入变化代理，不能替代正式财报审计和行业传导验证。",
        score_cap_policy="YoY financial abstract proxies are capped evidence and must be paired with commodity, valuation and risk facts.",
        frequency="quarterly_or_annual_reported_fields",
        required_evidence_keys=["earnings_transmission_proxy"],
        extra={
            "companyName": company["name"],
            "primaryExposure": company.get("primaryExposure"),
            "bucket": company.get("bucket"),
            "companyMetricKey": f"{metric_key}_yoy",
            "baseValue": comparison_value,
            "latestValue": value,
        },
    )


def _missing_financial_fact(
    *,
    fact_id: str,
    company: dict[str, Any],
    endpoint: str,
    missing_metrics: list[str],
) -> dict[str, Any]:
    return unavailable_fact(
        fact_id=fact_id,
        statement_zh=(
            f"Sina Finance 财务摘要未能为 {company['name']}（{company['code']}）标准化以下公司基本面指标："
            f"{', '.join(missing_metrics)}。缺失指标只能形成证据缺口，不能被写成正向事实。"
        ),
        metric_name="company_financial_metric_standardization_missing",
        source="SINA_FINANCE",
        source_type="public_data_via_named_collector",
        source_publisher="Sina Finance",
        access_provider="AKShare",
        collector="akshare_python_package_v0",
        endpoint=endpoint,
        domain="company_financials",
        entity=company["code"],
        locator=f"{company['code']}:missing_financial_metrics",
        original_location=f"akshare:{endpoint}:{company['code']}:missing_financial_metrics",
        policy_notes=_company_policy_notes(),
        unavailable_reason=f"missing standardized metrics: {', '.join(missing_metrics)}",
        source_warning="Missing company financial metrics must cap related N56 claims and cannot become positive evidence.",
        reliability_tier="public_data_via_named_collector",
        allowed_claim_types=COMPANY_FINANCIAL_ALLOWED_CLAIMS,
        not_allowed_claim_types=COMPANY_FINANCIAL_NOT_ALLOWED_CLAIMS,
        interpretation_hint="缺失公司基本面字段时，盈利传导和公司质量判断必须降权。",
        score_cap_policy="missing standardized company financial metrics cap earnings transmission and risk-reward claims.",
        frequency="quarterly_or_annual_reported_fields",
        required_evidence_keys=["earnings_transmission_proxy", "risk_reward_boundary"],
    )


def normalize_company_financial_facts(
    *,
    company_index: int,
    company: dict[str, Any],
    records: list[dict[str, Any]],
    endpoint: str,
    confidence: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    available_metrics: list[str] = []
    missing_metrics: list[str] = []
    latest_periods: set[str] = set()

    for metric_key, spec in METRIC_SPECS.items():
        row = _matching_row(records, spec["aliases"])
        if not row:
            missing_metrics.append(metric_key)
            continue
        period, value = _latest_value(row)
        if period is None or value is None:
            missing_metrics.append(metric_key)
            continue
        available_metrics.append(metric_key)
        latest_periods.add(period)
        facts.append(
            _metric_fact(
                fact_id=f"AKC-FIN-{company_index:03d}-{metric_key.upper()}",
                company=company,
                endpoint=endpoint,
                confidence=confidence,
                metric_key=metric_key,
                spec=spec,
                period=period,
                value=value,
            )
        )
        if metric_key in GROWTH_METRICS:
            comparison_period = _same_period_last_year(period)
            comparison_value = to_float(row.get(comparison_period)) if comparison_period else None
            if comparison_period and comparison_value is not None:
                growth = _growth_fact(
                    fact_id=f"AKC-GROWTH-{company_index:03d}-{metric_key.upper()}-YOY",
                    company=company,
                    endpoint=endpoint,
                    confidence=confidence,
                    metric_key=metric_key,
                    display_zh=spec["displayZh"],
                    period=period,
                    value=value,
                    comparison_period=comparison_period,
                    comparison_value=comparison_value,
                )
                if growth:
                    facts.append(growth)
            else:
                missing_metrics.append(f"{metric_key}_yoy")

    if available_metrics:
        period = sorted(latest_periods, reverse=True)[0] if latest_periods else "reported"
        facts.append(
            observation_fact(
                fact_id=f"AKC-PROFILE-{company_index:03d}",
                statement_zh=(
                    f"Sina Finance 财务摘要已为 {company['name']}（{company['code']}）标准化 {len(available_metrics)} 个公司基本面指标："
                    f"{', '.join(available_metrics)}。缺失指标包括：{', '.join(missing_metrics) if missing_metrics else '无主要缺失'}。"
                    "该公司画像只能作为公司基本面代理，不是完整行研底稿。"
                ),
                metric_name="company_profile_summary",
                value=len(available_metrics),
                unit="standardized_metrics_count",
                period=period,
                source="SINA_FINANCE",
                source_type="public_data_via_named_collector",
                source_publisher="Sina Finance",
                access_provider="AKShare",
                collector="akshare_python_package_v0",
                endpoint=endpoint,
                confidence=confidence,
                domain="company_financials",
                entity=company["code"],
                locator=f"{company['code']}:company_profile_summary",
                original_location=f"akshare:{endpoint}:{company['code']}:company_profile_summary",
                policy_notes=_company_policy_notes(),
                observed_at=period,
                transform="standardize selected stock_financial_abstract rows into company profile coverage summary",
                reliability_tier="public_data_via_named_collector",
                allowed_claim_types=COMPANY_FINANCIAL_ALLOWED_CLAIMS,
                not_allowed_claim_types=COMPANY_FINANCIAL_NOT_ALLOWED_CLAIMS,
                interpretation_hint="可帮助 PM / Company agent 快速识别公司层证据覆盖，但不能替代具体指标事实。",
                score_cap_policy="Company profile summaries are capped proxy evidence and should be paired with metric-level facts.",
                frequency="quarterly_or_annual_reported_fields",
                required_evidence_keys=["earnings_transmission_proxy", "valuation_proxy", "risk_reward_boundary"],
                extra={
                    "companyName": company["name"],
                    "primaryExposure": company.get("primaryExposure"),
                    "bucket": company.get("bucket"),
                    "availableFinancialMetrics": available_metrics,
                    "missingFinancialMetrics": missing_metrics,
                },
            )
        )
    else:
        facts.append(
            _missing_financial_fact(
                fact_id=f"AKC-MISSING-{company_index:03d}",
                company=company,
                endpoint=endpoint,
                missing_metrics=missing_metrics or list(METRIC_SPECS),
            )
        )

    return facts, {
        "availableMetrics": available_metrics,
        "missingMetrics": missing_metrics,
        "latestPeriods": sorted(latest_periods, reverse=True),
    }
