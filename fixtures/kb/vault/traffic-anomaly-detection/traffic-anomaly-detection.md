---
title: Traffic-AD
original_title: Traffic Anomaly Detection
venue: INFOCOM
year: 2022
tags: Anomaly, Adaptation, Architecture, Validation
---

# 流量异常检测方法

## 检测机制

对目标函数做正则化，并结合 architecture 约束，在 anomaly 与 drift 场景中提升 surrogate validation accuracy。

## 实现细节

系统采用端到端适配流程，对 experiment changes 保持可追踪归因。

## 局限性

在极端稀有类别场景中，模型容易出现阈值漂移。

## 迁移性分析

可把 adaptation 机制作用到目标函数，通过加权方法强化检测边界与 validation 稳定性。
