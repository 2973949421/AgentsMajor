# LLM Model Profiles

This registry is an asset contract. It stores driver ids and env var names only; no API keys, tokens, or secret values belong here.

## Runtime Boundary
- Binding scope: asset_preallocation
- Runtime enabled: false
- Driver registry: packages/llm/src/model-registry.ts
- Env refs: AGENT_MAJOR_REAL_LLM_ENABLED, AGENT_MAJOR_LLM_PROVIDER, DASHSCOPE_BASE_URL, DASHSCOPE_API_KEY

## Profiles
- llm_profile_strong_reasoning: News, profile cards, round reports, and narrative judgement. Primary=driver_qwen_3_max_2026_01_23; fallback=driver_qwen_3_6_plus; runtime_enabled=false.
- llm_profile_caster_expressive: Caster voice, interview voice, and high-emotion broadcast copy. Primary=driver_kimi_k2_5; fallback=driver_qwen_3_6_plus; runtime_enabled=false.
- llm_profile_barrage_chaos: Live-room barrage, meme lines, short reactions, and chaotic callbacks. Primary=driver_minimax_m2_5; fallback=driver_qwen_3_5_plus; runtime_enabled=false.
- llm_profile_conservative_judge_reserved: Judge, arbiter, and analysis reservation only. Disabled for v1. Primary=driver_glm_5; fallback=driver_glm_4_7; runtime_enabled=false.
- llm_profile_agent_action_reserved: Future agent action planning and repair reservation only. Disabled for v1. Primary=driver_qwen_3_coder_next; fallback=driver_qwen_3_coder_plus; runtime_enabled=false.
