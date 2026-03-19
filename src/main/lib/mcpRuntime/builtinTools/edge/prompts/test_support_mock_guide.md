\# LLM 智能Mock生成指南



\## 概述



本指南专门为LLM设计，\*\*基于代码分析结果\*\*，智能判断哪些依赖需要自定义Mock，哪些已有测试支持，并自动生成集中式、智能化的Mock文件。\*\*专注于智能Mock生成，所有Mock实现集中在单一文件中\*\*。



前置条件：已完成代码分析，了解类的依赖关系和方法签名。

核心目标：依赖分析结果 → 集中式智能Mock文件和测试环境配置类。



\## 智能Mock设计理念



1\. \*\*集中化管理\*\*：所有Mock实现集中在一个文件中，便于维护和管理

2\. \*\*智能行为\*\*：Mock能够自动适应不同的测试场景，减少手动设置

3\. \*\*状态感知\*\*：Mock能够跟踪和管理内部状态，模拟真实服务行为

4\. \*\*场景驱动\*\*：预设常见测试场景，一键切换测试环境



\## LLM执行流程



\### 第一步：智能依赖分析



\*\*输入：从代码分析阶段获得的依赖列表\*\*



```bash

\# 检查是否已有Mock/Fake/Testing实现

haystackSearch "Mock\[DependencyName]|Fake\[DependencyName]|\[DependencyName]Testing" --filter="\*.h"



\# 检查测试专用方法

haystackSearch "ForTesting|ForTest|SetupForTest" --filter="\*.h,\*.cc"



\# 检查框架测试支持

haystackSearch "TestingProfile|MockWebContents|FakeServiceManager" --filter="\*.h"



\# 分析方法调用模式

haystackSearch "callback|async|future|promise" --filter="\*.h,\*.cc"

```



\### 第二步：智能Mock策略决策



对每个依赖执行智能分析：



```

依赖X → 智能Mock策略



1\. 现有实现检查：

&#x20;  - 已有MockX/FakeX → 复用并扩展

&#x20;  - 已有XTesting → 包装为Mock接口

&#x20;  - 无现有实现 → 创建智能Mock



2\. 复杂度分析：

&#x20;  - 简单服务(1-2方法) → 智能默认Mock

&#x20;  - 中等服务(3-5方法) → 状态感知Mock

&#x20;  - 复杂服务(>5方法) → 场景驱动Mock

&#x20;  - 异步服务(有回调) → 异步智能Mock



3\. 智能行为配置：

&#x20;  - 自动检测参数类型并设置合理默认值

&#x20;  - 根据方法名推断行为模式

&#x20;  - 自动处理回调和异步操作

&#x20;  - 智能错误注入和边界情况模拟

```



\### 第三步：集中式智能Mock文件生成



\*\*生成单一集中式Mock文件，包含所有依赖的智能Mock实现：\*\*



\## 集中式智能Mock文件模板



\### 智能Mock头文件 (`smart\_mocks.h`)

```cpp

\#ifndef \[MODULE\_NAME]\_SMART\_MOCKS\_H\_

\#define \[MODULE\_NAME]\_SMART\_MOCKS\_H\_



\#include "testing/gmock/include/gmock/gmock.h"

\#include "testing/gtest/include/gtest/gtest.h"

\#include "base/callback.h"

\#include "base/memory/weak\_ptr.h"

\#include "base/timer/timer.h"

// 包含所有需要Mock的原始头文件



namespace \[namespace\_name] {

namespace testing {



// =============================================================================

// 智能Mock基类 - 提供通用智能行为

// =============================================================================

class SmartMockBase {

&#x20;public:

&#x20; SmartMockBase();

&#x20; virtual \~SmartMockBase();



&#x20; // 智能行为控制

&#x20; void EnableAutoResponse(bool enable) { auto\_response\_enabled\_ = enable; }

&#x20; void SetResponseDelay(base::TimeDelta delay) { response\_delay\_ = delay; }

&#x20; void SetFailureRate(double rate) { failure\_rate\_ = rate; }



&#x20; // 场景管理

&#x20; enum class Scenario {

&#x20;   kDefault,

&#x20;   kSuccess,

&#x20;   kFailure,

&#x20;   kTimeout,

&#x20;   kPartialFailure,

&#x20;   kNetworkError,

&#x20;   kCustom

&#x20; };



&#x20; void SetScenario(Scenario scenario);

&#x20; void ResetToDefault();



&#x20;protected:

&#x20; // 智能响应辅助方法

&#x20; template<typename CallbackType, typename ResultType>

&#x20; void SmartRespond(CallbackType callback, ResultType success\_result,

&#x20;                  ResultType failure\_result);



&#x20; bool ShouldSimulateFailure() const;

&#x20; base::TimeDelta GetResponseDelay() const;



&#x20;private:

&#x20; bool auto\_response\_enabled\_ = true;

&#x20; double failure\_rate\_ = 0.0;

&#x20; base::TimeDelta response\_delay\_;

&#x20; Scenario current\_scenario\_ = Scenario::kDefault;

&#x20; mutable int call\_count\_ = 0;

};



// =============================================================================

// 简单服务智能Mock（1-2个方法）

// =============================================================================

class Smart\[SimpleService]Mock : public \[SimpleServiceInterface],

&#x20;                                public SmartMockBase {

&#x20;public:

&#x20; Smart\[SimpleService]Mock();

&#x20; \~Smart\[SimpleService]Mock() override;



&#x20; // Mock方法 - 自动智能行为

&#x20; MOCK\_METHOD(\[ReturnType], \[Method1], (\[ParamTypes]), (override));

&#x20; MOCK\_METHOD(\[ReturnType], \[Method2], (\[ParamTypes]), (override));



&#x20; // 智能配置方法

&#x20; void ConfigureAutoResponse();

&#x20; void SetExpectedCallPattern(const std::vector<std::string>\& pattern);



&#x20;private:

&#x20; std::vector<std::string> expected\_call\_pattern\_;

&#x20; size\_t current\_call\_index\_ = 0;

};



// =============================================================================

// 状态感知智能Mock（3-5个方法）

// =============================================================================

class Smart\[StateService]Mock : public \[StateServiceInterface],

&#x20;                               public SmartMockBase {

&#x20;public:

&#x20; Smart\[StateService]Mock();

&#x20; \~Smart\[StateService]Mock() override;



&#x20; // Mock方法

&#x20; MOCK\_METHOD(\[ReturnType], \[InitMethod], (\[ParamTypes]), (override));

&#x20; MOCK\_METHOD(\[ReturnType], \[GetStateMethod], (\[ParamTypes]), (override));

&#x20; MOCK\_METHOD(\[ReturnType], \[UpdateMethod], (\[ParamTypes]), (override));

&#x20; MOCK\_METHOD(\[ReturnType], \[CleanupMethod], (\[ParamTypes]), (override));



&#x20; // 状态智能管理

&#x20; void SetInitialState(\[StateType] state);

&#x20; \[StateType] GetCurrentState() const { return current\_state\_; }

&#x20; void SimulateStateTransition(\[StateType] from, \[StateType] to);



&#x20; // 智能行为配置

&#x20; void EnableStateValidation(bool enable) { state\_validation\_enabled\_ = enable; }

&#x20; void SetStateTransitionRules(const std::map<\[StateType], std::vector<\[StateType]>>\& rules);



&#x20;private:

&#x20; \[StateType] current\_state\_;

&#x20; bool state\_validation\_enabled\_ = true;

&#x20; std::map<\[StateType], std::vector<\[StateType]>> transition\_rules\_;



&#x20; // 状态验证辅助方法

&#x20; bool IsValidTransition(\[StateType] from, \[StateType] to) const;

&#x20; void UpdateStateAfterCall(const std::string\& method\_name);

};



// =============================================================================

// 异步智能Mock（处理回调和异步操作）

// =============================================================================

class Smart\[AsyncService]Mock : public \[AsyncServiceInterface],

&#x20;                               public SmartMockBase {

&#x20;public:

&#x20; Smart\[AsyncService]Mock();

&#x20; \~Smart\[AsyncService]Mock() override;



&#x20; // 异步Mock方法

&#x20; MOCK\_METHOD(void, \[AsyncMethod1], (\[ParamTypes], \[CallbackType]), (override));

&#x20; MOCK\_METHOD(void, \[AsyncMethod2], (\[ParamTypes], \[CallbackType]), (override));

&#x20; MOCK\_METHOD(\[ReturnType], \[SyncMethod], (\[ParamTypes]), (override));



&#x20; // 异步操作智能控制

&#x20; void SetAsyncBehavior(bool complete\_immediately = false);

&#x20; void CompleteAllPendingOperations(bool success = true);

&#x20; void CompletePendingOperation(size\_t operation\_id, bool success = true);

&#x20; void SimulateTimeout(base::TimeDelta timeout\_delay);



&#x20; // 回调管理

&#x20; void SetCallbackPattern(const std::vector<bool>\& success\_pattern);

&#x20; void EnableCallbackQueue(bool enable) { callback\_queue\_enabled\_ = enable; }



&#x20;private:

&#x20; struct PendingOperation {

&#x20;   size\_t id;

&#x20;   base::OnceCallback<void(bool)> callback;

&#x20;   base::TimeTicks created\_time;

&#x20; };



&#x20; std::vector<PendingOperation> pending\_operations\_;

&#x20; std::vector<bool> callback\_success\_pattern\_;

&#x20; size\_t pattern\_index\_ = 0;

&#x20; bool callback\_queue\_enabled\_ = true;

&#x20; bool complete\_immediately\_ = false;

&#x20; size\_t next\_operation\_id\_ = 1;



&#x20; // 异步操作辅助方法

&#x20; void QueueCallback(base::OnceCallback<void(bool)> callback);

&#x20; void ProcessCallbackQueue();

&#x20; bool GetNextCallbackResult();

};



// =============================================================================

// 复杂服务智能Mock（>5个方法，场景驱动）

// =============================================================================

class Smart\[ComplexService]Mock : public \[ComplexServiceInterface],

&#x20;                                 public SmartMockBase {

&#x20;public:

&#x20; Smart\[ComplexService]Mock();

&#x20; \~Smart\[ComplexService]Mock() override;



&#x20; // 所有虚方法的Mock

&#x20; MOCK\_METHOD(\[ReturnType], \[Method1], (\[ParamTypes]), (override));

&#x20; MOCK\_METHOD(\[ReturnType], \[Method2], (\[ParamTypes]), (override));

&#x20; MOCK\_METHOD(\[ReturnType], \[Method3], (\[ParamTypes]), (override));

&#x20; // ... 更多MOCK\_METHOD



&#x20; // 场景驱动智能配置

&#x20; void LoadScenario(const std::string\& scenario\_name);

&#x20; void CreateCustomScenario(const std::map<std::string, ::testing::Action<void()>>\& actions);



&#x20; // 智能数据管理

&#x20; void SetDataProvider(std::unique\_ptr<\[DataProviderInterface]> provider);

&#x20; void EnableDataGeneration(bool enable) { data\_generation\_enabled\_ = enable; }



&#x20; // 性能模拟

&#x20; void SimulateLatency(const std::map<std::string, base::TimeDelta>\& method\_latencies);

&#x20; void SimulateResourceConstraints(bool limited\_resources = true);



&#x20;private:

&#x20; std::map<std::string, ::testing::Action<void()>> custom\_scenario\_;

&#x20; std::unique\_ptr<\[DataProviderInterface]> data\_provider\_;

&#x20; std::map<std::string, base::TimeDelta> method\_latencies\_;

&#x20; bool data\_generation\_enabled\_ = false;

&#x20; bool limited\_resources\_ = false;



&#x20; // 场景执行辅助方法

&#x20; void ExecuteScenarioAction(const std::string\& method\_name);

&#x20; \[DataType] GenerateSmartData(const std::string\& data\_type);

&#x20; void ApplyLatencySimulation(const std::string\& method\_name);

};



// =============================================================================

// 集中式Mock环境管理器

// =============================================================================

class SmartMockEnvironment {

&#x20;public:

&#x20; SmartMockEnvironment();

&#x20; \~SmartMockEnvironment();



&#x20; // Mock实例访问

&#x20; Smart\[SimpleService]Mock\* \[simple\_service]() { return \[simple\_service]\_mock\_.get(); }

&#x20; Smart\[StateService]Mock\* \[state\_service]() { return \[state\_service]\_mock\_.get(); }

&#x20; Smart\[AsyncService]Mock\* \[async\_service]() { return \[async\_service]\_mock\_.get(); }

&#x20; Smart\[ComplexService]Mock\* \[complex\_service]() { return \[complex\_service]\_mock\_.get(); }



&#x20; // 全局场景控制

&#x20; void SetGlobalScenario(SmartMockBase::Scenario scenario);

&#x20; void ResetAllMocks();

&#x20; void EnableGlobalAutoResponse(bool enable);



&#x20; // 智能测试模式

&#x20; void EnableRecordingMode(bool enable) { recording\_mode\_ = enable; }

&#x20; void ReplayRecordedInteractions();

&#x20; void ValidateInteractionPatterns();



&#x20; // 性能和可靠性测试

&#x20; void SimulateHighLoad();

&#x20; void SimulateNetworkIssues();

&#x20; void SimulateConcurrentAccess(int concurrent\_users = 10);



&#x20;private:

&#x20; std::unique\_ptr<Smart\[SimpleService]Mock> \[simple\_service]\_mock\_;

&#x20; std::unique\_ptr<Smart\[StateService]Mock> \[state\_service]\_mock\_;

&#x20; std::unique\_ptr<Smart\[AsyncService]Mock> \[async\_service]\_mock\_;

&#x20; std::unique\_ptr<Smart\[ComplexService]Mock> \[complex\_service]\_mock\_;



&#x20; bool recording\_mode\_ = false;

&#x20; std::vector<std::string> recorded\_interactions\_;



&#x20; void SetupDefaultBehaviors();

&#x20; void ConfigureSmartDefaults();

};



// =============================================================================

// 智能工厂和辅助函数

// =============================================================================



// 工厂方法

std::unique\_ptr<SmartMockEnvironment> CreateSmartMockEnvironment();



// 智能配置辅助函数

void ConfigureForIntegrationTesting(SmartMockEnvironment\* env);

void ConfigureForUnitTesting(SmartMockEnvironment\* env);

void ConfigureForPerformanceTesting(SmartMockEnvironment\* env);

void ConfigureForReliabilityTesting(SmartMockEnvironment\* env);



// 验证辅助函数

void VerifySmartMockInteractions(SmartMockEnvironment\* env);

void GenerateInteractionReport(SmartMockEnvironment\* env,

&#x20;                             const std::string\& output\_path);



}  // namespace testing

}  // namespace \[namespace\_name]



\#endif  // \[MODULE\_NAME]\_SMART\_MOCKS\_H\_

```



\### 智能Mock实现文件 (`smart\_mocks.cc`)

```cpp

// Copyright (C) Microsoft Corporation. All rights reserved.



\#include "\[module\_path]/smart\_mocks.h"



\#include "base/logging.h"

\#include "base/rand\_util.h"

\#include "base/threading/thread\_task\_runner\_handle.h"



namespace \[namespace\_name] {

namespace testing {



// =============================================================================

// SmartMockBase 实现

// =============================================================================



SmartMockBase::SmartMockBase() = default;

SmartMockBase::\~SmartMockBase() = default;



void SmartMockBase::SetScenario(Scenario scenario) {

&#x20; current\_scenario\_ = scenario;

&#x20; call\_count\_ = 0;



&#x20; switch (scenario) {

&#x20;   case Scenario::kSuccess:

&#x20;     failure\_rate\_ = 0.0;

&#x20;     response\_delay\_ = base::Milliseconds(10);

&#x20;     break;

&#x20;   case Scenario::kFailure:

&#x20;     failure\_rate\_ = 1.0;

&#x20;     response\_delay\_ = base::Milliseconds(50);

&#x20;     break;

&#x20;   case Scenario::kTimeout:

&#x20;     failure\_rate\_ = 0.0;

&#x20;     response\_delay\_ = base::Seconds(30);

&#x20;     break;

&#x20;   case Scenario::kPartialFailure:

&#x20;     failure\_rate\_ = 0.3;

&#x20;     response\_delay\_ = base::Milliseconds(100);

&#x20;     break;

&#x20;   case Scenario::kNetworkError:

&#x20;     failure\_rate\_ = 0.8;

&#x20;     response\_delay\_ = base::Milliseconds(500);

&#x20;     break;

&#x20;   default:

&#x20;     ResetToDefault();

&#x20;     break;

&#x20; }

}



void SmartMockBase::ResetToDefault() {

&#x20; current\_scenario\_ = Scenario::kDefault;

&#x20; failure\_rate\_ = 0.1;  // 10% 默认失败率，模拟真实环境

&#x20; response\_delay\_ = base::Milliseconds(50);

&#x20; call\_count\_ = 0;

}



template<typename CallbackType, typename ResultType>

void SmartMockBase::SmartRespond(CallbackType callback,

&#x20;                               ResultType success\_result,

&#x20;                               ResultType failure\_result) {

&#x20; if (!auto\_response\_enabled\_) return;



&#x20; ++call\_count\_;



&#x20; base::ThreadTaskRunnerHandle::Get()->PostDelayedTask(

&#x20;     FROM\_HERE,

&#x20;     base::BindOnce(

&#x20;         \[](CallbackType cb, ResultType success, ResultType failure, bool should\_fail) {

&#x20;           if (!cb.is\_null()) {

&#x20;             std::move(cb).Run(should\_fail ? failure : success);

&#x20;           }

&#x20;         },

&#x20;         std::move(callback), success\_result, failure\_result, ShouldSimulateFailure()),

&#x20;     GetResponseDelay());

}



bool SmartMockBase::ShouldSimulateFailure() const {

&#x20; // 智能失败模拟：考虑调用次数、场景和随机性

&#x20; if (current\_scenario\_ == Scenario::kSuccess) return false;

&#x20; if (current\_scenario\_ == Scenario::kFailure) return true;



&#x20; // 基于调用次数的智能失败率调整

&#x20; double adjusted\_failure\_rate = failure\_rate\_;

&#x20; if (call\_count\_ > 10) {

&#x20;   adjusted\_failure\_rate \*= 0.5;  // 长时间运行后减少失败率

&#x20; }



&#x20; return base::RandDouble() < adjusted\_failure\_rate;

}



base::TimeDelta SmartMockBase::GetResponseDelay() const {

&#x20; // 智能延迟：基于调用次数和场景调整

&#x20; base::TimeDelta base\_delay = response\_delay\_;



&#x20; if (call\_count\_ > 5) {

&#x20;   // 模拟缓存效果，减少延迟

&#x20;   base\_delay = base\_delay \* 0.7;

&#x20; }



&#x20; // 添加随机抖动，模拟真实网络条件

&#x20; int jitter\_ms = base::RandInt(-10, 10);

&#x20; return base\_delay + base::Milliseconds(jitter\_ms);

}



// =============================================================================

// Smart\[SimpleService]Mock 实现

// =============================================================================



Smart\[SimpleService]Mock::Smart\[SimpleService]Mock() {

&#x20; ConfigureAutoResponse();

}



Smart\[SimpleService]Mock::\~Smart\[SimpleService]Mock() = default;



void Smart\[SimpleService]Mock::ConfigureAutoResponse() {

&#x20; // 智能默认行为配置

&#x20; ON\_CALL(\*this, \[Method1](\_))

&#x20;     .WillByDefault(\[this](\[ParamTypes] params) {

&#x20;       // 智能参数验证和响应生成

&#x20;       if (ShouldSimulateFailure()) {

&#x20;         return \[FailureValue];

&#x20;       }

&#x20;       return \[SuccessValue];

&#x20;     });



&#x20; ON\_CALL(\*this, \[Method2](\_))

&#x20;     .WillByDefault(\[this](\[ParamTypes] params) {

&#x20;       // 基于参数智能生成响应

&#x20;       return GenerateSmartResponse(params);

&#x20;     });

}



void Smart\[SimpleService]Mock::SetExpectedCallPattern(

&#x20;   const std::vector<std::string>\& pattern) {

&#x20; expected\_call\_pattern\_ = pattern;

&#x20; current\_call\_index\_ = 0;

}



// =============================================================================

// Smart\[AsyncService]Mock 实现

// =============================================================================



Smart\[AsyncService]Mock::Smart\[AsyncService]Mock() {

&#x20; // 配置异步智能行为

&#x20; ON\_CALL(\*this, \[AsyncMethod1](\_, \_))

&#x20;     .WillByDefault(\[this](\[ParamTypes] params, \[CallbackType] callback) {

&#x20;       QueueCallback(std::move(callback));

&#x20;     });

}



Smart\[AsyncService]Mock::\~Smart\[AsyncService]Mock() = default;



void Smart\[AsyncService]Mock::QueueCallback(base::OnceCallback<void(bool)> callback) {

&#x20; if (complete\_immediately\_) {

&#x20;   bool success = GetNextCallbackResult();

&#x20;   base::ThreadTaskRunnerHandle::Get()->PostTask(

&#x20;       FROM\_HERE,

&#x20;       base::BindOnce(std::move(callback), success));

&#x20;   return;

&#x20; }



&#x20; PendingOperation operation;

&#x20; operation.id = next\_operation\_id\_++;

&#x20; operation.callback = std::move(callback);

&#x20; operation.created\_time = base::TimeTicks::Now();



&#x20; pending\_operations\_.push\_back(std::move(operation));



&#x20; if (!callback\_queue\_enabled\_) {

&#x20;   ProcessCallbackQueue();

&#x20; }

}



void Smart\[AsyncService]Mock::ProcessCallbackQueue() {

&#x20; for (auto\& operation : pending\_operations\_) {

&#x20;   bool success = GetNextCallbackResult();

&#x20;   base::ThreadTaskRunnerHandle::Get()->PostDelayedTask(

&#x20;       FROM\_HERE,

&#x20;       base::BindOnce(std::move(operation.callback), success),

&#x20;       GetResponseDelay());

&#x20; }

&#x20; pending\_operations\_.clear();

}



bool Smart\[AsyncService]Mock::GetNextCallbackResult() {

&#x20; if (callback\_success\_pattern\_.empty()) {

&#x20;   return !ShouldSimulateFailure();

&#x20; }



&#x20; bool result = callback\_success\_pattern\_\[pattern\_index\_];

&#x20; pattern\_index\_ = (pattern\_index\_ + 1) % callback\_success\_pattern\_.size();

&#x20; return result;

}



// =============================================================================

// SmartMockEnvironment 实现

// =============================================================================



SmartMockEnvironment::SmartMockEnvironment() {

&#x20; // 创建所有智能Mock实例

&#x20; \[simple\_service]\_mock\_ = std::make\_unique<Smart\[SimpleService]Mock>();

&#x20; \[state\_service]\_mock\_ = std::make\_unique<Smart\[StateService]Mock>();

&#x20; \[async\_service]\_mock\_ = std::make\_unique<Smart\[AsyncService]Mock>();

&#x20; \[complex\_service]\_mock\_ = std::make\_unique<Smart\[ComplexService]Mock>();



&#x20; SetupDefaultBehaviors();

}



SmartMockEnvironment::\~SmartMockEnvironment() = default;



void SmartMockEnvironment::SetGlobalScenario(SmartMockBase::Scenario scenario) {

&#x20; \[simple\_service]\_mock\_->SetScenario(scenario);

&#x20; \[state\_service]\_mock\_->SetScenario(scenario);

&#x20; \[async\_service]\_mock\_->SetScenario(scenario);

&#x20; \[complex\_service]\_mock\_->SetScenario(scenario);

}



void SmartMockEnvironment::ResetAllMocks() {

&#x20; \[simple\_service]\_mock\_->ResetToDefault();

&#x20; \[state\_service]\_mock\_->ResetToDefault();

&#x20; \[async\_service]\_mock\_->ResetToDefault();

&#x20; \[complex\_service]\_mock\_->ResetToDefault();



&#x20; SetupDefaultBehaviors();

}



void SmartMockEnvironment::SetupDefaultBehaviors() {

&#x20; // 配置智能默认行为，让大部分测试开箱即用

&#x20; ConfigureSmartDefaults();

}



void SmartMockEnvironment::ConfigureSmartDefaults() {

&#x20; // 智能默认配置，基于常见使用模式

&#x20; \[simple\_service]\_mock\_->EnableAutoResponse(true);

&#x20; \[async\_service]\_mock\_->SetAsyncBehavior(false);  // 异步但快速响应

&#x20; \[state\_service]\_mock\_->EnableStateValidation(true);

}



void SmartMockEnvironment::SimulateHighLoad() {

&#x20; // 模拟高负载场景

&#x20; \[simple\_service]\_mock\_->SetResponseDelay(base::Milliseconds(200));

&#x20; \[async\_service]\_mock\_->SetResponseDelay(base::Milliseconds(500));

&#x20; \[complex\_service]\_mock\_->SimulateResourceConstraints(true);

}



// =============================================================================

// 工厂和辅助函数实现

// =============================================================================



std::unique\_ptr<SmartMockEnvironment> CreateSmartMockEnvironment() {

&#x20; return std::make\_unique<SmartMockEnvironment>();

}



void ConfigureForIntegrationTesting(SmartMockEnvironment\* env) {

&#x20; env->SetGlobalScenario(SmartMockBase::Scenario::kDefault);

&#x20; env->EnableGlobalAutoResponse(true);

}



void ConfigureForUnitTesting(SmartMockEnvironment\* env) {

&#x20; env->SetGlobalScenario(SmartMockBase::Scenario::kSuccess);

&#x20; env->EnableGlobalAutoResponse(false);  // 单元测试需要精确控制

}



void ConfigureForPerformanceTesting(SmartMockEnvironment\* env) {

&#x20; env->SimulateHighLoad();

&#x20; env->SetGlobalScenario(SmartMockBase::Scenario::kPartialFailure);

}



void VerifySmartMockInteractions(SmartMockEnvironment\* env) {

&#x20; // 智能验证：自动检查常见交互模式

&#x20; ::testing::Mock::VerifyAndClearExpectations(env->\[simple\_service]());

&#x20; ::testing::Mock::VerifyAndClearExpectations(env->\[async\_service]());

&#x20; ::testing::Mock::VerifyAndClearExpectations(env->\[state\_service]());

&#x20; ::testing::Mock::VerifyAndClearExpectations(env->\[complex\_service]());

}



}  // namespace testing

}  // namespace \[namespace\_name]

```



\## 智能Mock使用示例



\### 基本使用

```cpp

TEST\_F(\[TestClass], SmartMockBasicUsage) {

&#x20; auto mock\_env = CreateSmartMockEnvironment();



&#x20; // 智能Mock自动处理大部分场景

&#x20; auto result = service\_under\_test\_->CallService();



&#x20; // 自动验证

&#x20; VerifySmartMockInteractions(mock\_env.get());

}

```



\### 场景驱动测试

```cpp

TEST\_F(\[TestClass], ScenarioDrivenTesting) {

&#x20; auto mock\_env = CreateSmartMockEnvironment();



&#x20; // 一键切换到失败场景

&#x20; mock\_env->SetGlobalScenario(SmartMockBase::Scenario::kFailure);



&#x20; auto result = service\_under\_test\_->CallService();

&#x20; EXPECT\_FALSE(result.success);

}

```



\### 异步操作测试

```cpp

TEST\_F(\[TestClass], AsyncOperationTesting) {

&#x20; auto mock\_env = CreateSmartMockEnvironment();



&#x20; // 配置异步模式

&#x20; mock\_env->\[async\_service]()->SetCallbackPattern({true, false, true});



&#x20; bool callback\_called = false;

&#x20; service\_under\_test\_->StartAsyncOperation(

&#x20;     base::BindOnce(\[\&](bool success) { callback\_called = true; }));



&#x20; // 智能完成所有pending操作

&#x20; mock\_env->\[async\_service]()->CompleteAllPendingOperations();



&#x20; EXPECT\_TRUE(callback\_called);

}

```



\## LLM执行步骤总结



\### 输入

\- 代码分析结果（依赖列表、方法签名、接口复杂度、调用模式）



\### 执行步骤

1\. \*\*智能依赖分析\*\*：搜索现有Mock实现，分析方法调用模式

2\. \*\*智能Mock策略\*\*：根据复杂度和使用模式选择合适的智能Mock类型

3\. \*\*集中式Mock生成\*\*：生成单一智能Mock文件，包含所有依赖的Mock实现



\### 输出

\- `smart\_mocks.h` - 集中式智能Mock头文件

\- `smart\_mocks.cc` - 集中式智能Mock实现文件

\- 使用示例和最佳实践指南



\### 智能特性

\- \*\*自动响应生成\*\*：基于参数类型和方法名智能生成合理响应

\- \*\*场景驱动测试\*\*：预设测试场景，一键切换测试环境

\- \*\*状态感知\*\*：智能跟踪和验证状态转换

\- \*\*异步操作支持\*\*：智能处理回调和异步操作

\- \*\*性能模拟\*\*：模拟真实环境的延迟和失败率

\- \*\*集中管理\*\*：所有Mock集中在一个文件中，便于维护



\### 优势

1\. \*\*减少维护成本\*\*：所有Mock集中管理，避免分散在多个文件

2\. \*\*提高测试智能化\*\*：自动处理常见测试场景，减少手动配置

3\. \*\*增强测试覆盖\*\*：智能模拟边界情况和异常场景

4\. \*\*简化测试编写\*\*：开箱即用的智能行为，加速测试开发



