# LLM Role Binding Templates

Role templates are the default maintenance unit. Individual agents inherit from these templates unless a small spotlight override is generated.

- llm_role_template_igl: role=igl; preferred=driver_qwen_3_max_2026_01_23; tasks=profile_card_copy, news_story_copy, tactical_analysis_note, broadcast_caster_line.
- llm_role_template_awper: role=awper; preferred=driver_kimi_k2_5; tasks=profile_card_copy, news_story_copy, broadcast_caster_line, spotlight_moment_copy.
- llm_role_template_entry: role=entry; preferred=driver_minimax_m2_5; tasks=profile_card_copy, broadcast_caster_line, barrage_style_line, meme_reaction_line.
- llm_role_template_lurker: role=lurker; preferred=driver_qwen_3_max_2026_01_23; tasks=profile_card_copy, news_story_copy, tactical_analysis_note, broadcast_caster_line.
- llm_role_template_rifler: role=rifler; preferred=driver_qwen_3_6_plus; tasks=profile_card_copy, broadcast_caster_line, barrage_style_line.
- llm_role_template_coach: role=coach; preferred=driver_qwen_3_max_2026_01_23; tasks=profile_card_copy, news_story_copy, tactical_analysis_note, judge_note_reserved.
