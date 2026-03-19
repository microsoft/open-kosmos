\# LLM测试用例生成指南



\## 概述



本指南专门为LLM设计，\*\*基于代码分析结果和Mock文件\*\*，系统化地创建测试用例以实现高代码覆盖率。\*\*专注于测试用例编写和测试环境配置，不涉及代码分析或Mock接口生成。\*\*



前置条件：已完成代码分析和Mock生成，了解类的方法列表和可用的Mock对象。

核心目标：代码分析结果 + Mock文件 → 完整的测试用例文件。



\## LLM测试生成流程



\### 第一步：测试覆盖点识别



\*\*输入：从代码分析阶段获得的方法列表和分支信息\*\*



基于已有的代码分析结果，识别需要测试的关键点：

\- 所有公共方法（已从代码分析获得）

\- 条件分支位置（已从代码分析获得）

\- 异步回调方法（已从代码分析获得）

\- 错误处理路径（已从代码分析获得）



\### 第二步：测试用例分类设计



根据方法功能分类设计测试用例：



```

测试用例分类框架：



1\. 基础功能测试

&#x20;  - 构造函数测试

&#x20;  - 基本方法调用测试

&#x20;  - getter/setter测试



2\. 业务逻辑测试

&#x20;  - 正常流程测试

&#x20;  - 边界值测试

&#x20;  - 组合操作测试



3\. 异常处理测试

&#x20;  - 无效输入测试

&#x20;  - 依赖失败测试

&#x20;  - 资源不足测试



4\. 异步操作测试

&#x20;  - 回调成功测试

&#x20;  - 回调失败测试

&#x20;  - 超时处理测试



5\. 状态管理测试

&#x20;  - 状态转换测试

&#x20;  - 并发访问测试

&#x20;  - 清理重置测试

```



\### 第三步：测试环境配置设计



\*\*输入：从Mock生成阶段获得的Mock文件列表\*\*



基于已生成的Mock文件设计测试环境配置：



```cpp

// 依赖注入模式识别：

1\. 构造函数注入 → 在SetUp中创建Mock并传入

2\. 工厂方法注入 → 使用SetForTesting替换

3\. 静态依赖注入 → 全局Mock替换

4\. 运行时注入 → 方法参数Mock

```



\### 第四步：测试用例生成



根据分析结果生成具体的测试用例文件。



\## 测试文件生成模板



\### 基础测试文件结构

```cpp

\#include "testing/gtest/include/gtest/gtest.h"

\#include "testing/gmock/include/gmock/gmock.h"

\#include "chrome/test/base/testing\_profile.h"

\#include "\[目标类头文件]"

\#include "\[所有Mock头文件]"



using ::testing::\_;

using ::testing::Return;

using ::testing::StrictMock;

using ::testing::InSequence;



namespace {



class \[ClassName]Test : public testing::Test {

&#x20;public:

&#x20; void SetUp() override {

&#x20;   // 1. 创建TestingProfile

&#x20;   profile\_ = std::make\_unique<TestingProfile>();



&#x20;   // 2. 创建所有Mock对象

&#x20;   mock\_dependency1\_ = std::make\_unique<StrictMock<MockDependency1>>();

&#x20;   mock\_dependency2\_ = std::make\_unique<StrictMock<MockDependency2>>();



&#x20;   // 3. 设置工厂方法替换（如果需要）

&#x20;   DependencyFactory::SetForTesting(mock\_dependency1\_.get());



&#x20;   // 4. 创建待测试对象

&#x20;   CreateTargetObject();

&#x20; }



&#x20; void TearDown() override {

&#x20;   // 清理顺序很重要

&#x20;   target\_object\_.reset();

&#x20;   mock\_dependency2\_.reset();

&#x20;   mock\_dependency1\_.reset();

&#x20;   profile\_.reset();



&#x20;   // 重置工厂方法

&#x20;   DependencyFactory::SetForTesting(nullptr);

&#x20; }



&#x20;protected:

&#x20; void CreateTargetObject() {

&#x20;   target\_object\_ = std::make\_unique<\[ClassName]>(

&#x20;       profile\_.get(),

&#x20;       mock\_dependency1\_.get(),

&#x20;       mock\_dependency2\_.get());

&#x20; }



&#x20; // 常用的Mock行为设置

&#x20; void SetupDefaultMockBehavior() {

&#x20;   ON\_CALL(\*mock\_dependency1\_, GetValue())

&#x20;       .WillByDefault(Return(default\_value));

&#x20;   ON\_CALL(\*mock\_dependency2\_, IsReady())

&#x20;       .WillByDefault(Return(true));

&#x20; }



&#x20; void SetupFailureMockBehavior() {

&#x20;   ON\_CALL(\*mock\_dependency1\_, GetValue())

&#x20;       .WillByDefault(Return(std::nullopt));

&#x20;   ON\_CALL(\*mock\_dependency2\_, IsReady())

&#x20;       .WillByDefault(Return(false));

&#x20; }



&#x20; std::unique\_ptr<TestingProfile> profile\_;

&#x20; std::unique\_ptr<StrictMock<MockDependency1>> mock\_dependency1\_;

&#x20; std::unique\_ptr<StrictMock<MockDependency2>> mock\_dependency2\_;

&#x20; std::unique\_ptr<\[ClassName]> target\_object\_;

};



}  // namespace

```



\### 基础功能测试模板

```cpp

// 1. 构造函数测试

TEST\_F(\[ClassName]Test, ConstructorInitializesCorrectly) {

&#x20; // 验证对象创建成功

&#x20; EXPECT\_NE(target\_object\_, nullptr);



&#x20; // 验证初始状态

&#x20; EXPECT\_EQ(target\_object\_->GetState(), InitialState);

}



TEST\_F(\[ClassName]Test, ConstructorWithNullDependency) {

&#x20; // 测试nullptr依赖的处理

&#x20; target\_object\_.reset();

&#x20; EXPECT\_DEATH\_IF\_SUPPORTED(

&#x20;     std::make\_unique<\[ClassName]>(profile\_.get(), nullptr, mock\_dependency2\_.get()),

&#x20;     "");

}



// 2. 基本方法测试

TEST\_F(\[ClassName]Test, BasicMethodCall) {

&#x20; SetupDefaultMockBehavior();



&#x20; // 设置期望

&#x20; EXPECT\_CALL(\*mock\_dependency1\_, Method1())

&#x20;     .WillOnce(Return(expected\_result));



&#x20; // 执行测试

&#x20; auto result = target\_object\_->PublicMethod(input\_data);



&#x20; // 验证结果

&#x20; EXPECT\_EQ(result, expected\_result);

}



// 3. Getter/Setter测试

TEST\_F(\[ClassName]Test, SetterAndGetter) {

&#x20; const auto test\_value = TestValue();



&#x20; target\_object\_->SetValue(test\_value);

&#x20; EXPECT\_EQ(target\_object\_->GetValue(), test\_value);

}

```



\### 业务逻辑测试模板

```cpp

// 1. 正常流程测试

TEST\_F(\[ClassName]Test, NormalWorkflow) {

&#x20; SetupDefaultMockBehavior();



&#x20; // 设置调用序列期望

&#x20; InSequence seq;

&#x20; EXPECT\_CALL(\*mock\_dependency1\_, Initialize())

&#x20;     .WillOnce(Return(true));

&#x20; EXPECT\_CALL(\*mock\_dependency2\_, Process(\_))

&#x20;     .WillOnce(Return(ProcessResult::kSuccess));

&#x20; EXPECT\_CALL(\*mock\_dependency1\_, Finalize())

&#x20;     .WillOnce(Return(true));



&#x20; // 执行完整工作流

&#x20; bool result = target\_object\_->ExecuteWorkflow(input\_data);



&#x20; EXPECT\_TRUE(result);

}



// 2. 边界值测试

TEST\_F(\[ClassName]Test, BoundaryValues) {

&#x20; SetupDefaultMockBehavior();



&#x20; // 测试最小值

&#x20; EXPECT\_TRUE(target\_object\_->ProcessValue(MinValue));



&#x20; // 测试最大值

&#x20; EXPECT\_TRUE(target\_object\_->ProcessValue(MaxValue));



&#x20; // 测试空值

&#x20; EXPECT\_FALSE(target\_object\_->ProcessValue(EmptyValue));

}



// 3. 组合操作测试

TEST\_F(\[ClassName]Test, MultipleOperations) {

&#x20; SetupDefaultMockBehavior();



&#x20; // 执行多个操作

&#x20; target\_object\_->Operation1();

&#x20; target\_object\_->Operation2();

&#x20; target\_object\_->Operation3();



&#x20; // 验证最终状态

&#x20; EXPECT\_EQ(target\_object\_->GetFinalState(), ExpectedFinalState);

}

```



\### 异常处理测试模板

```cpp

// 1. 无效输入测试

TEST\_F(\[ClassName]Test, InvalidInputHandling) {

&#x20; SetupDefaultMockBehavior();



&#x20; // 测试nullptr输入

&#x20; EXPECT\_FALSE(target\_object\_->ProcessData(nullptr));



&#x20; // 测试无效格式输入

&#x20; auto invalid\_data = CreateInvalidData();

&#x20; EXPECT\_FALSE(target\_object\_->ProcessData(\&invalid\_data));

}



// 2. 依赖失败测试

TEST\_F(\[ClassName]Test, DependencyFailureHandling) {

&#x20; // 设置依赖失败

&#x20; EXPECT\_CALL(\*mock\_dependency1\_, CriticalOperation())

&#x20;     .WillOnce(Return(false));



&#x20; // 验证优雅失败

&#x20; bool result = target\_object\_->ExecuteOperation();

&#x20; EXPECT\_FALSE(result);



&#x20; // 验证错误状态

&#x20; EXPECT\_EQ(target\_object\_->GetLastError(), ErrorType::kDependencyFailure);

}



// 3. 资源不足测试

TEST\_F(\[ClassName]Test, ResourceExhaustionHandling) {

&#x20; // 模拟资源不足

&#x20; EXPECT\_CALL(\*mock\_dependency1\_, AllocateResource())

&#x20;     .WillRepeatedly(Return(nullptr));



&#x20; // 验证降级处理

&#x20; bool result = target\_object\_->ProcessLargeData(large\_data);

&#x20; EXPECT\_TRUE(result);  // 应该降级但不失败

}

```



\### 异步操作测试模板

```cpp

// 1. 异步回调成功测试

TEST\_F(\[ClassName]Test, AsyncOperationSuccess) {

&#x20; SetupDefaultMockBehavior();



&#x20; bool callback\_called = false;

&#x20; auto callback = base::BindOnce(\[\&callback\_called](bool success) {

&#x20;   EXPECT\_TRUE(success);

&#x20;   callback\_called = true;

&#x20; });



&#x20; // 启动异步操作

&#x20; target\_object\_->StartAsyncOperation(std::move(callback));



&#x20; // 模拟异步完成

&#x20; target\_object\_->OnAsyncComplete(true);



&#x20; EXPECT\_TRUE(callback\_called);

}



// 2. 异步回调失败测试

TEST\_F(\[ClassName]Test, AsyncOperationFailure) {

&#x20; bool callback\_called = false;

&#x20; auto callback = base::BindOnce(\[\&callback\_called](bool success) {

&#x20;   EXPECT\_FALSE(success);

&#x20;   callback\_called = true;

&#x20; });



&#x20; target\_object\_->StartAsyncOperation(std::move(callback));

&#x20; target\_object\_->OnAsyncComplete(false);



&#x20; EXPECT\_TRUE(callback\_called);

}



// 3. 超时处理测试

TEST\_F(\[ClassName]Test, AsyncOperationTimeout) {

&#x20; base::test::TaskEnvironment task\_environment{

&#x20;     base::test::TaskEnvironment::TimeSource::MOCK\_TIME};



&#x20; bool callback\_called = false;

&#x20; auto callback = base::BindOnce(\[\&callback\_called](bool success) {

&#x20;   EXPECT\_FALSE(success);

&#x20;   callback\_called = true;

&#x20; });



&#x20; target\_object\_->StartAsyncOperation(std::move(callback));



&#x20; // 模拟超时

&#x20; task\_environment.FastForwardBy(base::Seconds(30));



&#x20; EXPECT\_TRUE(callback\_called);

}

```



\### 状态管理测试模板

```cpp

// 1. 状态转换测试

TEST\_F(\[ClassName]Test, StateTransitions) {

&#x20; // 初始状态

&#x20; EXPECT\_EQ(target\_object\_->GetState(), State::kInitial);



&#x20; // 状态转换1

&#x20; target\_object\_->Start();

&#x20; EXPECT\_EQ(target\_object\_->GetState(), State::kRunning);



&#x20; // 状态转换2

&#x20; target\_object\_->Stop();

&#x20; EXPECT\_EQ(target\_object\_->GetState(), State::kStopped);



&#x20; // 非法状态转换

&#x20; EXPECT\_FALSE(target\_object\_->Start());  // 从Stopped不能直接到Running

}



// 2. 并发访问测试

TEST\_F(\[ClassName]Test, ConcurrentAccess) {

&#x20; SetupDefaultMockBehavior();



&#x20; std::vector<std::thread> threads;

&#x20; std::atomic<int> success\_count{0};



&#x20; // 启动多个线程同时访问

&#x20; for (int i = 0; i < 10; ++i) {

&#x20;   threads.emplace\_back(\[\&]() {

&#x20;     if (target\_object\_->ThreadSafeOperation()) {

&#x20;       success\_count++;

&#x20;     }

&#x20;   });

&#x20; }



&#x20; // 等待所有线程完成

&#x20; for (auto\& thread : threads) {

&#x20;   thread.join();

&#x20; }



&#x20; // 验证线程安全

&#x20; EXPECT\_EQ(success\_count.load(), 10);

}

```



\## 代码覆盖率优化策略



\### 覆盖率检查清单

```

路径覆盖检查：

\- \[ ] 所有if/else分支已测试

\- \[ ] 所有switch/case已测试

\- \[ ] 所有循环路径已测试（0次、1次、多次）

\- \[ ] 所有异常路径已测试



方法覆盖检查：

\- \[ ] 所有public方法已测试

\- \[ ] 所有重要的private方法已间接测试

\- \[ ] 所有虚方法重写已测试

\- \[ ] 所有回调方法已测试



数据覆盖检查：

\- \[ ] 所有成员变量状态已测试

\- \[ ] 所有输入参数组合已测试

\- \[ ] 所有返回值类型已测试

\- \[ ] 所有错误码路径已测试

```



\### 高覆盖率测试生成策略

```cpp

// 1. 参数化测试（覆盖多种输入组合）

class \[ClassName]ParameterizedTest : public \[ClassName]Test,

&#x20;                                   public testing::WithParamInterface<TestCase> {

&#x20;protected:

&#x20; struct TestCase {

&#x20;   InputType input;

&#x20;   ExpectedResult expected;

&#x20;   std::string description;

&#x20; };

};



TEST\_P(\[ClassName]ParameterizedTest, ProcessVariousInputs) {

&#x20; const auto\& test\_case = GetParam();

&#x20; SetupDefaultMockBehavior();



&#x20; auto result = target\_object\_->ProcessInput(test\_case.input);



&#x20; EXPECT\_EQ(result, test\_case.expected) << test\_case.description;

}



INSTANTIATE\_TEST\_SUITE\_P(

&#x20;   VariousInputs,

&#x20;   \[ClassName]ParameterizedTest,

&#x20;   testing::Values(

&#x20;       TestCase{ValidInput1, Success, "Valid input 1"},

&#x20;       TestCase{ValidInput2, Success, "Valid input 2"},

&#x20;       TestCase{InvalidInput1, Failure, "Invalid input 1"},

&#x20;       TestCase{EdgeInput1, Success, "Edge case 1"}));



// 2. 死代码检查（确保所有代码路径可达）

TEST\_F(\[ClassName]Test, UnreachableCodeCheck) {

&#x20; // 通过特殊设置触发罕见代码路径

&#x20; SetupSpecialConditions();



&#x20; // 执行可能触发死代码的操作

&#x20; target\_object\_->RarelyCalledMethod();



&#x20; // 验证代码确实执行了

&#x20; EXPECT\_TRUE(target\_object\_->WasRarePathExecuted());

}

```



\## LLM执行步骤总结



\### 输入

\- 代码分析结果（方法列表、分支信息、异步回调）

\- Mock文件列表（从第二阶段生成的Mock接口）

\- 待测试的类名



\### 执行步骤

1\. \*\*覆盖点分析\*\*：识别所有需要测试的方法、分支、异步操作

2\. \*\*测试分类设计\*\*：按功能类型设计测试用例分类

3\. \*\*依赖注入设计\*\*：基于Mock文件设计依赖注入策略

4\. \*\*测试用例生成\*\*：使用模板生成具体测试用例

5\. \*\*覆盖率验证\*\*：检查是否覆盖所有重要代码路径



\### 输出

\- `\[class\_name]\_unittest.cc` - 完整的单元测试文件

\- 参数化测试（如果需要）

\- 性能测试（如果有性能要求）

\- 集成测试（如果有复杂交互）



\### 质量保证检查清单

\- \[ ] 所有公共方法都有对应测试

\- \[ ] 所有条件分支都被覆盖

\- \[ ] 所有异常情况都被测试

\- \[ ] 所有异步操作都被验证

\- \[ ] Mock对象的行为设置正确

\- \[ ] 测试用例独立且可重复

\- \[ ] 测试名称清晰描述测试内容

\- \[ ] 断言具体且有意义



