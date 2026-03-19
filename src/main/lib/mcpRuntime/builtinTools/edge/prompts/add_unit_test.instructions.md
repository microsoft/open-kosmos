\# Chromium/Edge C++ Unit Testing Comprehensive Guide



This document provides a complete guide for Chromium/Edge C++ unit test development, including instruction specifications, code templates, best practices, and common problem solutions. Focuses on unit testing and does not include browser test related content.



\## Table of Contents



1\. \[Quick Troubleshooting Guide](#1-quick-troubleshooting-guide)

2\. \[Test File Templates and Naming Conventions](#2-test-file-templates-and-naming-conventions)

3\. \[Common Test Patterns](#3-common-test-patterns)

4\. \[Component-Specific Testing Guidelines](#4-component-specific-testing-guidelines)

5\. \[BUILD.gn Configuration Guide](#5-buildgn-configuration-guide)

6\. \[Mock and Dependency Injection](#6-mock-and-dependency-injection)

7\. \[Testing Tools and Assertions](#7-testing-tools-and-assertions)

8\. \[Advanced Testing Patterns and Problem Resolution](#8-advanced-testing-patterns-and-problem-resolution)

9\. \[Code Search and Analysis Commands](#9-code-search-and-analysis-commands)

10\. \[Complete Test Implementation Templates](#10-complete-test-implementation-templates)

11\. \[Build Integration Templates](#11-build-integration-templates)

12\. \[Implementation Checklist](#12-implementation-checklist)

13\. \[Advanced Problem Prevention Strategies](#13-advanced-problem-prevention-strategies)



\---



\## 1. Quick Troubleshooting Guide



\### 1.1 Common Build Issues



```bash

\# Issue: "undefined reference to 'SomeClass::Method'"

\# Solution: Add missing dependency to BUILD.gn deps

deps = \[

&#x20; "//path/to/missing/target",

]



\# Issue: "fatal error: 'some\_header.h' file not found"

\# Solution: Add proper include path or dependency



\# Issue: "multiple definition of 'symbol'"

\# Solution: Check for duplicate source files in BUILD.gn or BUILD\_edge.gni

```



\### 1.2 Common Test Runtime Issues



```cpp

// Issue: Test crashes with "Check failed: likes observers\_.empty()"

// Solution: Disable auto-initialization services

SomeService::SetDisableForTesting();



// Issue: Mock expectations not met

// Solution: Ensure message loop runs

task\_environment\_.RunUntilIdle();



// Issue: Async test timeout

// Solution: Use TestFuture for async operations

base::test::TestFuture<bool> future;

EXPECT\_TRUE(future.Get());

```



\### 1.3 Feature Flag and Service Setup Issues



```cpp

// Issue: Service returns nullptr in tests

// Solution: Enable service creation for testing, try KeyedServiceFactory if private method

SomeServiceFactory::GetInstance()->SetServiceIsNullWhileTesting(false);



// Issue: Feature is disabled by default

// Solution: Enable feature flag in test setup

scoped\_feature\_list\_.InitAndEnableFeature(features::kSomeFeature);



// Issue: Service not injected properly

// Solution: Set up service factory before creating test object

SomeServiceFactory::GetInstance()->SetTestingFactory(

&#x20;   profile\_.get(), base::BindRepeating(\&CreateMockService));

```



\### 1.4 Friend Access and Private Method Testing Issues



```cpp

// Issue: Cannot access private method in test

// Solution: Add friend test macro in header file

FRIEND\_TEST\_ALL\_PREFIXES(TestClassName, PrivateMethodName);



// Issue: Friend test macro placement

// Solution: Place friend macros in private section of class

class SomeClass {

&#x20;public:

&#x20; // ... public methods

&#x20;private:

&#x20; FRIEND\_TEST\_ALL\_PREFIXES(SomeClassTest, PrivateMethod);

&#x20; // ... private methods

};

```



\### 1.5 Search Strategy Tips



\- \*\*Limit HaystackSearch results\*\*: Use specific keywords (max 3) and limit to 5 results

\- \*\*Search in same directory first\*\*: Look for `\*\_unittest.cc` files in the same folder

\- \*\*Check existing patterns\*\*: Find similar test classes before creating new ones

\- \*\*Feature flag search\*\*: Use `haystackSearch` with feature name to find default state

\- \*\*Service factory search\*\*: Look for "Factory" + service name to understand injection



\---



\## 2. Test File Templates and Naming Conventions



\### 2.1 Basic Template Structure



```cpp

// Copyright 2024 The Chromium Authors

// Use of this source code is governed by a BSD-style license that can be

// found in the LICENSE file.



\#include "path/to/your/file.h"



\#include <memory>

\#include <string>

\#include <vector>



\#include "base/test/task\_environment.h"

\#include "testing/gmock/include/gmock/gmock.h"

\#include "testing/gtest/include/gtest/gtest.h"



namespace your\_namespace {



class YourClassTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   // Initialize test objects here

&#x20; }



&#x20; void TearDown() override {

&#x20;   // Clean up in reverse order

&#x20;   task\_environment\_.RunUntilIdle();

&#x20; }



&#x20; base::test::TaskEnvironment task\_environment\_;

&#x20; // Add test member variables here

};



TEST\_F(YourClassTest, BasicFunctionality) {

&#x20; // Arrange - Set up test data and expectations

&#x20; // Act - Call the method being tested

&#x20; // Assert - Verify the results

}



}  // namespace your\_namespace

```



\### 2.2 Naming Conventions



\- \*\*Test files\*\*: `foo.cc` → `foo\_unittest.cc` (same directory)

\- \*\*Test classes\*\*: `HttpCache` → `HttpCacheTest`

\- \*\*Test methods\*\*: `TEST\_F(TestClass, MethodName\_Scenario\_ExpectedResult)`



```cpp

TEST\_F(HttpCacheTest, Get\_ValidUrl\_ReturnsData)

TEST\_F(HttpCacheTest, Get\_InvalidUrl\_ReturnsError)

```



\---



\## 3. Common Test Patterns



\### 3.1 Basic Test Patterns



\#### 3.1.1 Simple Value Testing

```cpp

TEST\_F(MyClassTest, SetValue\_ValidInput) {

&#x20; MyClass obj;

&#x20; obj.SetValue(42);

&#x20; EXPECT\_EQ(42, obj.GetValue());

}

```



\#### 3.1.2 Mock Object Testing

```cpp

class MockDelegate : public MyClass::Delegate {

&#x20;public:

&#x20; MOCK\_METHOD(void, OnUpdate, (int value), (override));

};



TEST\_F(MyClassTest, ProcessData\_CallsDelegate) {

&#x20; auto mock\_delegate = std::make\_unique<MockDelegate>();

&#x20; EXPECT\_CALL(\*mock\_delegate, OnUpdate(testing::\_)).Times(1);



&#x20; MyClass obj(std::move(mock\_delegate));

&#x20; obj.ProcessData("test");

}

```



\#### 3.1.3 Async Operation Testing

```cpp

TEST\_F(MyClassTest, AsyncOperation\_CompletesSuccessfully) {

&#x20; base::test::TestFuture<bool> future;



&#x20; obj.StartAsyncOperation(future.GetCallback());

&#x20; EXPECT\_TRUE(future.Get());

}

```



\#### 3.1.4 Error Condition Testing

```cpp

TEST\_F(MyClassTest, ProcessData\_InvalidInput\_ReturnsError) {

&#x20; MyClass obj;

&#x20; auto result = obj.ProcessData("");

&#x20; EXPECT\_FALSE(result.success);

&#x20; EXPECT\_EQ(MyClass::Error::INVALID\_INPUT, result.error);

}

```



\### 3.2 Parameterized Tests



```cpp

class MyClassParameterizedTest : public testing::TestWithParam<int> {};



TEST\_P(MyClassParameterizedTest, ProcessValue\_DifferentInputs) {

&#x20; MyClass obj;

&#x20; auto result = obj.ProcessValue(GetParam());

&#x20; EXPECT\_TRUE(result.IsValid());

}



INSTANTIATE\_TEST\_SUITE\_P(DifferentValues, MyClassParameterizedTest,

&#x20;                        testing::Values(1, 5, 10, 100));

```



\---



\## 4. Component-Specific Testing Guidelines



\### 4.1 Content Layer Component Testing



\#### 4.1.1 Content Layer Setup

```cpp

\#include "content/public/test/test\_renderer\_host.h"



class ContentLayerComponentTest : public content::RenderViewHostTestHarness {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   content::RenderViewHostTestHarness::SetUp();

&#x20;   component\_ = std::make\_unique<MyComponent>(web\_contents());

&#x20; }



&#x20; std::unique\_ptr<MyComponent> component\_;

};

```



\### 4.2 Network Component Testing



\#### 4.2.1 Network Component Setup

```cpp

\#include "services/network/test/test\_url\_loader\_factory.h"



class NetworkComponentTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   test\_shared\_loader\_factory\_ =

&#x20;       base::MakeRefCounted<network::WeakWrapperSharedURLLoaderFactory>(

&#x20;           \&test\_url\_loader\_factory\_);

&#x20; }



&#x20; network::TestURLLoaderFactory test\_url\_loader\_factory\_;

&#x20; scoped\_refptr<network::SharedURLLoaderFactory> test\_shared\_loader\_factory\_;

&#x20; base::test::TaskEnvironment task\_environment\_;

};

```



\#### 4.2.2 Network Request Testing Example

```cpp

TEST\_F(NetworkComponentTest, FetchData\_SuccessfulResponse) {

&#x20; const GURL test\_url("https://example.com/api/data");

&#x20; test\_url\_loader\_factory\_.AddResponse(test\_url, R"({"result": "success"})", net::HTTP\_OK);



&#x20; MyNetworkComponent component(test\_shared\_loader\_factory\_);

&#x20; component.FetchData(test\_url, base::DoNothing());

&#x20; task\_environment\_.RunUntilIdle();

&#x20; // Verify component handled the response correctly

}

```



\### 4.3 File Operations Testing



\#### 4.3.1 File Operation Setup

```cpp

\#include "base/files/scoped\_temp\_dir.h"



class FileOperationTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   ASSERT\_TRUE(temp\_dir\_.CreateUniqueTempDir());

&#x20; }



&#x20; base::ScopedTempDir temp\_dir\_;

&#x20; base::test::TaskEnvironment task\_environment\_;

};

```



\---



\## 5. BUILD.gn Configuration Guide



\### 5.1 Finding Existing Test Targets



\#### 5.1.1 Common Test Target Patterns

Look for patterns like:

```gn

source\_set("unit\_tests") { ... }

source\_set("unittests") { ... }

source\_set("tests") { ... }



```



\### 5.2 Adding Test Files



\#### 5.2.1 Step-by-Step BUILD.gn Configuration

```gn

\# Step 1: Find or create local test target

source\_set("unit\_tests") {

&#x20; testonly = true

&#x20; sources = \[

&#x20;   "existing\_test.cc",

&#x20;   "your\_new\_test\_unittest.cc",  # Add your test here

&#x20; ]



&#x20; # Step 2: Copy dependencies from component being tested

&#x20; deps = \[

&#x20;   ":your\_component",  # The component being tested

&#x20;   "//base/test:test\_support",

&#x20;   "//testing/gtest",

&#x20;   "//testing/gmock",

&#x20; ]



&#x20; # Step 3: Add any additional test dependencies

&#x20; deps += \[

&#x20;   "//chrome/test:test\_support",  # If testing Chrome components

&#x20;   "//content/test:test\_support", # If testing Content components

&#x20; ]

}

```



\### 5.3 Test Target Directory Mapping



\#### 5.3.1 Top-level Test Targets by Directory

\- `//components/\*` → `components\_unittests`

\- `//content/\*` → `content\_unittests`

\- `//services/\*` → `services\_unittests`

\- `//chrome/\*` → `unit\_tests`

\#### 5.3.2 Add local test file or local test target into the Top-level Test Targets

\- `BUILD\_edge.gni` for test file under `chrome` folder



\### 5.4 Build and Run Commands

Use the mcp tool to build the top-level test target



\## 6. Mock and Dependency Injection



\### 6.1 WebContents Testing Environment Usage



> \*\*Important Note\*\*: WebContents is a core browser component class with well-established test base classes and environment support. \*\*Manual mocking of WebContents is not recommended\*\*; use instances provided by test base classes directly.



\#### 6.1.1 Recommended WebContents Usage

```cpp

\#include "content/public/test/test\_web\_contents\_factory.h"

\#include "content/public/test/web\_contents\_tester.h"



class WebContentsTest : public content::RenderViewHostTestHarness {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   content::RenderViewHostTestHarness::SetUp();



&#x20;   // web\_contents() is automatically provided by base class, no need to manually create or mock

&#x20;   content::WebContentsTester::For(web\_contents())

&#x20;       ->SetLastCommittedURL(GURL("https://example.com"));



&#x20;   component\_ = std::make\_unique<ComponentWithWebContents>(web\_contents());

&#x20; }



&#x20; std::unique\_ptr<ComponentWithWebContents> component\_;

};

```



\### 6.2 Profile Testing and Dependency Injection



> \*\*Important Note\*\*: Profile is a core browser component class. \*\*Manual mocking of Profile is not recommended\*\*; use TestingProfile directly.



```cpp

\#include "chrome/test/base/testing\_profile.h"



class ProfileDependentTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   TestingProfile::Builder builder;

&#x20;   profile\_ = builder.Build();

&#x20;   component\_ = std::make\_unique<ComponentWithProfile>(profile\_.get());

&#x20; }



&#x20; std::unique\_ptr<TestingProfile> profile\_;

&#x20; std::unique\_ptr<ComponentWithProfile> component\_;

&#x20; base::test::TaskEnvironment task\_environment\_;

};

```



\### 6.3 URLLoader Testing and Dependency Injection



> \*\*Important Note\*\*: URLLoader is a network component. \*\*Manual mocking of URLLoader is not recommended\*\*; use TestURLLoaderFactory.



```cpp

\#include "services/network/test/test\_url\_loader\_factory.h"



class URLLoaderTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   test\_shared\_loader\_factory\_ =

&#x20;       base::MakeRefCounted<network::WeakWrapperSharedURLLoaderFactory>(

&#x20;           \&test\_url\_loader\_factory\_);

&#x20;   component\_ = std::make\_unique<ComponentWithURLLoader>(

&#x20;       test\_shared\_loader\_factory\_);

&#x20; }



&#x20; network::TestURLLoaderFactory test\_url\_loader\_factory\_;

&#x20; scoped\_refptr<network::SharedURLLoaderFactory> test\_shared\_loader\_factory\_;

&#x20; std::unique\_ptr<ComponentWithURLLoader> component\_;

&#x20; base::test::TaskEnvironment task\_environment\_;

};

```



\### 6.4 KeyedService Mock and Injection



\#### 6.4.1 KeyedService Factory Injection Method

```cpp

class MockMyKeyedService : public MyKeyedService {

&#x20;public:

&#x20; explicit MockMyKeyedService(content::BrowserContext\* context)

&#x20;     : MyKeyedService(context) {}



&#x20; MOCK\_METHOD(std::string, GetData, (), (override));

&#x20; MOCK\_METHOD(void, ProcessData, (const std::string\& data), (override));

};



class KeyedServiceTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   TestingProfile::Builder builder;

&#x20;   profile\_ = builder.Build();



&#x20;   auto mock\_service = std::make\_unique<MockMyKeyedService>(profile\_.get());

&#x20;   mock\_service\_ = mock\_service.get();



&#x20;   MyKeyedServiceFactory::SetTestingFactory(

&#x20;       profile\_.get(),

&#x20;       base::BindRepeating(\[](content::BrowserContext\* context)

&#x20;                          -> std::unique\_ptr<KeyedService> {

&#x20;         return std::make\_unique<MockMyKeyedService>(context);

&#x20;       }));

&#x20; }



&#x20; std::unique\_ptr<TestingProfile> profile\_;

&#x20; raw\_ptr<MockMyKeyedService> mock\_service\_;

&#x20; base::test::TaskEnvironment task\_environment\_;

};

```



\### 6.6 Non-Virtual Function Virtualization and Mock Implementation



\#### 6.5.1 Wrapper Pattern for Virtualization

```cpp

// Original class containing non-virtual functions

class OriginalClass {

&#x20;public:

&#x20; std::string GetName() const { return "original"; }  // Non-virtual function

&#x20; void SetValue(int value) { value\_ = value; }        // Non-virtual function

&#x20; int GetValue() const { return value\_; }             // Non-virtual function

&#x20;private:

&#x20; int value\_ = 0;

};



// Create interface to make non-virtual functions virtual

class IOriginalClassWrapper {

&#x20;public:

&#x20; virtual \~IOriginalClassWrapper() = default;

&#x20; virtual std::string GetName() const = 0;

&#x20; virtual void SetValue(int value) = 0;

&#x20; virtual int GetValue() const = 0;

};



// Actual wrapper implementation

class OriginalClassWrapper : public IOriginalClassWrapper {

&#x20;public:

&#x20; explicit OriginalClassWrapper(std::unique\_ptr<OriginalClass> original)

&#x20;     : original\_(std::move(original)) {}



&#x20; std::string GetName() const override {

&#x20;   return original\_->GetName();

&#x20; }



&#x20; void SetValue(int value) override {

&#x20;   original\_->SetValue(value);

&#x20; }



&#x20; int GetValue() const override {

&#x20;   return original\_->GetValue();

&#x20; }



&#x20;private:

&#x20; std::unique\_ptr<OriginalClass> original\_;

};



// Mock implementation

class MockOriginalClassWrapper : public IOriginalClassWrapper {

&#x20;public:

&#x20; MOCK\_METHOD(std::string, GetName, (), (const, override));

&#x20; MOCK\_METHOD(void, SetValue, (int value), (override));

&#x20; MOCK\_METHOD(int, GetValue, (), (const, override));

};

```



\### 6.5 Setter Injection Pattern for Mock Dependencies



> \*\*Key Principle\*\*: Use setter injection methods to inject mock dependencies rather than constructor injection. This approach maintains object state across test cases and allows for better test isolation. And can inject nullptr to support different scenarios



\#### 6.5.1 Mock Setter Injection Template with Feature Flag Support

```cpp

// In your target class header file, add testing setters

class MyTargetClass {

&#x20;public:

&#x20; // Standard methods

&#x20; void DoSomething();



&#x20; // Testing-only setter methods

&#x20; void SetDependency1ForTesting(Dependency1\* dependency);

&#x20; void SetDependency2ForTesting(Dependency2\* dependency);



&#x20;private:

&#x20; // Friend test access for private methods

&#x20; FRIEND\_TEST\_ALL\_PREFIXES(MyTargetClassTest, PrivateMethod);

&#x20; FRIEND\_TEST\_ALL\_PREFIXES(MyTargetClassTest, OnObserverCallback);



&#x20; raw\_ptr<Dependency1> dependency1\_;

&#x20; raw\_ptr<Dependency2> dependency2\_;

};



// In your target class implementation

void MyTargetClass::SetDependency1ForTesting(Dependency1\* dependency) {

&#x20; dependency1\_ = dependency;

}



void MyTargetClass::SetDependency2ForTesting(Dependency2\* dependency) {

&#x20; dependency2\_ = dependency;

}

```



\#### 6.5.2 Complete Test Setup with Feature Flags and Service Injection

```cpp

class MyTargetClassTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   // 1. FIRST: Enable feature flags

&#x20;   scoped\_feature\_list\_.InitAndEnableFeature(features::kMyFeature);



&#x20;   // 2. SECOND: Configure service factories

&#x20;   SomeServiceFactory::GetInstance()->SetServiceIsNullWhileTesting(false);



&#x20;   // 3. THIRD: Set up service factory with mock whilc the target class access to the service by factory

&#x20;   SomeServiceFactory::GetInstance()->SetTestingFactory(

&#x20;       profile\_.get(),

&#x20;       base::BindRepeating(\&MyTargetClassTest::CreateMockService,

&#x20;                           base::Unretained(this)));



&#x20;   // 4. FOURTH: Create mock dependencies

&#x20;   mock\_dependency1\_ = std::make\_unique<MockDependency1>();

&#x20;   mock\_dependency2\_ = std::make\_unique<MockDependency2>();



&#x20;   // 5. FIFTH: Create target object

&#x20;   target\_ = std::make\_unique<MyTargetClass>();



&#x20;   // 6. SIXTH: Inject mocks using setter methods

&#x20;   target\_->SetDependency1ForTesting(mock\_dependency1\_.get());

&#x20;   target\_->SetDependency2ForTesting(mock\_dependency2\_.get());

&#x20; }



&#x20; void TearDown() override {

&#x20;   target\_.reset();

&#x20;   mock\_dependency2\_.reset();

&#x20;   mock\_dependency1\_.reset();

&#x20;   profile\_.reset();



&#x20;   // Restore service factory defaults

&#x20;   SomeServiceFactory::GetInstance()->SetServiceIsNullWhileTesting(true);

&#x20; }



&#x20; void ResetMockExpectations() {

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_dependency1\_.get());

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_dependency2\_.get());

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_service\_ptr\_);

&#x20; }



&#x20; std::unique\_ptr<KeyedService> CreateMockService(content::BrowserContext\* context) {

&#x20;   auto mock = std::make\_unique<MockSomeService>();

&#x20;   mock\_service\_ptr\_ = mock.get();

&#x20;   return mock;

&#x20; }



&#x20; base::test::ScopedFeatureList scoped\_feature\_list\_;

&#x20; std::unique\_ptr<TestingProfile> profile\_;

&#x20; std::unique\_ptr<MyTargetClass> target\_;

&#x20; std::unique\_ptr<MockDependency1> mock\_dependency1\_;

&#x20; std::unique\_ptr<MockDependency2> mock\_dependency2\_;

&#x20; raw\_ptr<MockSomeService> mock\_service\_ptr\_ = nullptr;

};

&#x20; void ResetMockExpectations() {

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_dependency1\_.get());

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_dependency2\_.get());

&#x20; }



&#x20; base::test::TaskEnvironment task\_environment\_;

&#x20; std::unique\_ptr<TestingProfile> testing\_profile\_;

&#x20; std::unique\_ptr<MockDependency1> mock\_dependency1\_;

&#x20; std::unique\_ptr<MockDependency2> mock\_dependency2\_;

&#x20; std::unique\_ptr<MyTargetClass> target\_class\_;

};



// Example test case - objects persist across tests

TEST\_F(MyTargetClassTest, SomeMethod\_ValidInput\_Success) {

&#x20; // Set up expectations on existing mocks

&#x20; EXPECT\_CALL(\*mock\_dependency1\_, DoSomething(\_))

&#x20;     .WillOnce(Return(true));



&#x20; // Call method on existing target class

&#x20; bool result = target\_class\_->SomeMethod("test");



&#x20; // Verify results

&#x20; EXPECT\_TRUE(result);



&#x20; // Clean up expectations for next test

&#x20; ResetMockExpectations();

}

```



\#### 6.5.3 Benefits of Setter Injection Pattern



1\. \*\*State Persistence\*\*: Objects maintain state across test cases

2\. \*\*Performance\*\*: No repeated object creation/destruction

3\. \*\*Realistic Testing\*\*: More closely mimics production object lifecycle

4\. \*\*Isolation\*\*: Can still reset expectations between tests

5\. \*\*Flexibility\*\*: Easy to swap different mock implementations during testing

\---



\## 7. Testing Tools and Assertions



\### 7.1 Basic Assertions



```cpp

// Equality and comparisons

EXPECT\_EQ(expected, actual);

EXPECT\_TRUE(condition);

EXPECT\_FALSE(condition);



// Null checks

EXPECT\_EQ(nullptr, pointer);

EXPECT\_NE(nullptr, pointer);



// String comparisons

EXPECT\_EQ("expected", actual\_string);



// Container checks

EXPECT\_EQ(3u, vector.size());

EXPECT\_THAT(vector, testing::ElementsAre(1, 2, 3));

EXPECT\_THAT(vector, testing::Contains(42));

```



\### 7.2 Mock Expectations



```cpp

// Method call expectations

EXPECT\_CALL(mock\_object, MethodName()).Times(1);

EXPECT\_CALL(mock\_object, MethodName(testing::\_)).WillOnce(testing::Return(true));

```



\### 7.3 Histogram Testing Patterns



\#### 7.3.1 Basic Histogram Testing

```cpp

TEST\_F(MyComponentTest, RecordsHistogramOnSuccess) {

&#x20; base::HistogramTester histogram\_tester;



&#x20; MyComponent component;

&#x20; component.ProcessData("valid\_input");



&#x20; // Verify that exactly one sample was recorded with value 1

&#x20; histogram\_tester.ExpectUniqueSample("MyComponent.ProcessResult", 1, 1);

&#x20; histogram\_tester.ExpectTotalCount("MyComponent.ProcessResult", 1);

}

```



\#### 7.3.2 Bucket-Specific Testing

```cpp

TEST\_F(MyComponentTest, RecordsSpecificBucketValues) {

&#x20; base::HistogramTester histogram\_tester;



&#x20; MyComponent component;

&#x20; component.ProcessData("fast\_operation");  // Records value 10

&#x20; component.ProcessData("slow\_operation");  // Records value 100



&#x20; // Verify specific bucket counts

&#x20; histogram\_tester.ExpectBucketCount("MyComponent.OperationTime", 10, 1);

&#x20; histogram\_tester.ExpectBucketCount("MyComponent.OperationTime", 100, 1);

&#x20; histogram\_tester.ExpectTotalCount("MyComponent.OperationTime", 2);

}

```



\---



\## 8. Advanced Testing Patterns and Problem Resolution



\### 8.1 Observer Pattern Safety



```cpp

class ComponentWithObserverTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   component\_ = std::make\_unique<Component>();

&#x20;   mock\_observer\_ = std::make\_unique<MockObserver>();

&#x20;   component\_->AddObserver(mock\_observer\_.get());

&#x20; }



&#x20; void TearDown() override {

&#x20;   // Remove observers before destruction

&#x20;   if (component\_ \&\& mock\_observer\_) {

&#x20;     component\_->RemoveObserver(mock\_observer\_.get());

&#x20;   }



&#x20;   // Clean up in reverse order

&#x20;   mock\_observer\_.reset();

&#x20;   component\_.reset();

&#x20;   task\_environment\_.RunUntilIdle();

&#x20; }



&#x20; base::test::TaskEnvironment task\_environment\_;

&#x20; std::unique\_ptr<Component> component\_;

&#x20; std::unique\_ptr<MockObserver> mock\_observer\_;

};

```



\### 8.2 Async Operation Synchronization Patterns



```cpp

// Pattern 1: TestFuture for single async operations

TEST\_F(ComponentTest, AsyncMethod\_CompletesSuccessfully) {

&#x20; base::test::TestFuture<bool> future;



&#x20; component\_->AsyncMethod(future.GetCallback());

&#x20; EXPECT\_TRUE(future.Get());  // Blocks until callback is called

}



// Pattern 2: RunLoop for multiple async operations

TEST\_F(ComponentTest, MultipleAsyncOperations\_AllComplete) {

&#x20; int completed\_count = 0;

&#x20; base::RunLoop run\_loop;



&#x20; auto completion\_callback = base::BindLambdaForTesting(\[\&]() {

&#x20;   ++completed\_count;

&#x20;   if (completed\_count == 3) {

&#x20;     run\_loop.Quit();

&#x20;   }

&#x20; });



&#x20; component\_->AsyncMethod1(completion\_callback);

&#x20; component\_->AsyncMethod2(completion\_callback);

&#x20; component\_->AsyncMethod3(completion\_callback);



&#x20; run\_loop.Run();

&#x20; EXPECT\_EQ(3, completed\_count);

}

```



\### 8.3 Network and External Dependency Testing



```cpp

class NetworkComponentTest : public testing::Test {

&#x20;protected:

&#x20; void SetupSuccessResponse(const GURL\& url, const std::string\& json\_response) {

&#x20;   test\_url\_loader\_factory\_.AddResponse(url, json\_response, net::HTTP\_OK);

&#x20; }



&#x20; void SetupErrorResponse(const GURL\& url, net::Error error) {

&#x20;   test\_url\_loader\_factory\_.AddResponse(url, "", net::HTTP\_OK, error);

&#x20; }



&#x20; void SetupTimeoutResponse(const GURL\& url) {

&#x20;   test\_url\_loader\_factory\_.AddResponse(url, "", net::HTTP\_REQUEST\_TIMEOUT);

&#x20; }



&#x20; network::TestURLLoaderFactory test\_url\_loader\_factory\_;

&#x20; scoped\_refptr<network::SharedURLLoaderFactory> test\_shared\_loader\_factory\_;

};

```



\### 8.4 System Error Resolution Strategies



\#### 8.4.1 Observer Cleanup Error Resolution

```cpp

/\*\*

&#x20;\* Observer Cleanup Error Pattern Analysis:

&#x20;\*

&#x20;\* Error: "Check failed: observers\_.empty()"

&#x20;\* Root Cause: Service adds observer during async initialization,

&#x20;\*            but ProfileManager destroys before service cleanup

&#x20;\*

&#x20;\* Resolution Strategy:

&#x20;\* 1. Identify the service causing the issue (from stack trace)

&#x20;\* 2. Find the feature flag that enables the service

&#x20;\* 3. Disable the feature flag in test setup

&#x20;\* 4. If no feature flag, find SetDisable\*ForTesting() method

&#x20;\*/



class ProblematicServiceTest : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   // Method 1: Disable via feature flag

&#x20;   scoped\_feature\_list\_.InitAndDisableFeature(

&#x20;       features::edge::kServiceThatCausesObserverIssues);



&#x20;   // Method 2: Disable via testing method

&#x20;   ProblematicService::SetDisableForTesting();



&#x20;   // Method 3: Control initialization timing

&#x20;   ProblematicService::SetSkipAsyncInitializationForTesting();

&#x20; }



&#x20;private:

&#x20; base::test::ScopedFeatureList scoped\_feature\_list\_;

&#x20; base::test::TaskEnvironment task\_environment\_;

};

```



\---



\## 9. Code Search and Analysis Commands



\### 9.1 File Structure Analysis Commands



```bash

\# Read complete target file

read\_file("\[target\_file\_path]", 1, \[max\_lines])



\# Read header file

read\_file("\[target\_file\_header]", 1, \[max\_lines])

```



\### 9.2 Code Search Commands



```bash

\# Search for method definitions (limit to 5 results)

haystackSearch("class \[ClassName]" --workspace="\[workspace\_path]" --filter="\*.h,\*.cc" --limit=5)



\# Search for observer patterns

haystackSearch("\[ClassName]Observer" --workspace="\[workspace\_path]" --filter="\*.h" --limit=5)



\# Search for existing tests

haystackFiles("\[class\_name]\_unittest.cc" --workspace="\[workspace\_path]" --limit=3)



\# Search for factory patterns

haystackSearch("Factory::GetForProfile|Factory::GetInstance" --workspace="\[workspace\_path]" --filter="\*.cc,\*.h" --limit=5)



\# Search for existing mocks (limit results)

haystackSearch("Mock\[ClassName]|Testing\[ClassName]|Fake\[ClassName]" --workspace="\[workspace\_path]" --filter="\*.h" --limit=5)

```



\### 9.1.1 Function-to-Dependency Analysis Commands



```bash

\# Search for systematic mock discovery

haystackSearch("Mock{ClassName}", workspace)

haystackSearch("Test{ClassName}", workspace)

haystackSearch("Fake{ClassName}", workspace)

haystackSearch("{ClassName}Factory SetTestingFactory", workspace)

haystackSearch("Testing{ClassName}", workspace)



\# System class test support search

haystackSearch("TestingProfile", workspace)

haystackSearch("TestWebContents", workspace)

haystackSearch("TestWebUI MockWebUI", workspace)

haystackSearch("TestURLLoaderFactory TestURLLoader", workspace)

```



\### 9.1.2 Function Analysis Mapping Format

```

Function: MethodName(params) -> return\_type

├── External Dep 1: ClassName::method() -> Mock Strategy: \[USE\_EXISTING/CREATE\_NEW/NO\_MOCK]

├── External Dep 2: ServiceName::operation() -> Mock Strategy: \[USE\_EXISTING/CREATE\_NEW/NO\_MOCK]

├── Static Method Calls: InternalClass::StaticMethod() -> Test Strategy: \[DIRECT\_TEST/MOCK\_DEPS]

└── System Class Access: profile()->GetPrefs() -> Mock Strategy: \[USE\_TESTING\_PROFILE]

```



\### 9.1.3 Test Coverage Matrix Format

```

Target File: {filename}.cc/.h

├── Public Methods:

│   ├── Method1(params) -> Test: TestMethod1\_Success, TestMethod1\_Error, TestMethod1\_EdgeCase

│   ├── Method2(params) -> Test: TestMethod2\_ValidInput, TestMethod2\_NullInput

│   └── Method3(params) -> Test: TestMethod3\_...

├── Private Methods:

│   ├── PrivateMethod1() -> Test: TestPrivateMethod1\_InternalLogic (requires friend access)

│   └── PrivateMethod2() -> Test: TestPrivateMethod2\_... (requires friend access)

├── Static Methods:

│   ├── StaticMethod1() -> Test: TestStaticMethod1\_DirectTest, TestStaticMethod1\_EdgeCase

│   └── StaticMethod2() -> Test: TestStaticMethod2\_... (test actual implementation)

└── Observer Methods:

&#x20;   ├── OnSomeEvent() -> Test: TestOnSomeEvent\_CorrectResponse

&#x20;   └── OnCallback() -> Test: TestOnCallback\_DataProcessing

```



\### 9.3 Build System Commands



```bash

\# Find BUILD.gn in target file directory

haystackFiles("BUILD.gn" --workspace="\[target\_file\_directory]" --limit=1)



\# Read BUILD.gn file

read\_file("\[build\_gn\_path]", 1, \[max\_lines])



\# Check if test file exists

haystackFiles("\[class\_name]\_unittest.cc" --workspace="\[workspace\_path]" --limit=1)

```



\### 9.4 Build and Test Commands



```bash

\# Build with MCP tool

mcp\_edge\_ut\_build\_target(buildTarget="\[top\_level\_target]")



\# Run tests with specific filter

mcp\_edge\_ut\_run\_tests(

&#x20; testTarget="\[top\_level\_target]",

&#x20; testFilter="\[ClassName]Test.\*"

)



\# Run all tests for the component

mcp\_edge\_ut\_run\_tests(

&#x20; testTarget="\[top\_level\_target]",

&#x20; testFilter="\*\[Component]\*.\*"

)

```



\---



\## 10. Complete Test Implementation Templates



\### 10.1 Complete Test File Structure



```cpp

\#include "\[target\_class\_header].h"



\#include <memory>

\#include <string>

\#include <vector>



\#include "base/test/task\_environment.h"

\#include "chrome/test/base/testing\_profile.h"

\#include "content/test/test\_web\_ui.h"

\#include "testing/gmock/include/gmock/gmock.h"

\#include "testing/gtest/include/gtest/gtest.h"



// Include all mock headers

\#include "\[mock\_header\_1].h"

\#include "\[mock\_header\_2].h"



using ::testing::\_;

using ::testing::Return;

using ::testing::StrictMock;



namespace \[namespace] {



class \[ClassName]Test : public testing::Test {

&#x20;protected:

&#x20; void SetUp() override {

&#x20;   // Initialize TestingProfile and other system components ONCE

&#x20;   testing\_profile\_ = TestingProfile::Builder().Build();

&#x20;   web\_contents\_ = TestWebContents::Create(testing\_profile\_.get(), nullptr);



&#x20;   // Create ALL mocks ONCE

&#x20;   mock\_service\_a\_ = std::make\_unique<MockServiceA>();

&#x20;   mock\_service\_b\_ = std::make\_unique<MockServiceB>();



&#x20;   // Create target object being tested

&#x20;   target\_object\_ = std::make\_unique<TargetClass>(testing\_profile\_.get());



&#x20;   // Inject ALL mocks using setter methods

&#x20;   target\_object\_->SetServiceAForTesting(mock\_service\_a\_.get());

&#x20;   target\_object\_->SetServiceBForTesting(mock\_service\_b\_.get());

&#x20;   target\_object\_->SetWebContentsForTesting(web\_contents\_.get());



&#x20;   // Configure default mock behaviors

&#x20;   SetupDefaultMockBehaviors();

&#x20; }



&#x20; void SetupDefaultMockBehaviors() {

&#x20;   // Set up default expectations that apply to multiple tests

&#x20;   ON\_CALL(\*mock\_service\_a\_, GetData())

&#x20;       .WillByDefault(Return("default\_data"));

&#x20;   ON\_CALL(\*mock\_service\_b\_, IsValid())

&#x20;       .WillByDefault(Return(true));

&#x20; }



&#x20; // Test infrastructure - created ONCE, persistent across tests

&#x20; std::unique\_ptr<TestingProfile> testing\_profile\_;

&#x20; std::unique\_ptr<TestWebContents> web\_contents\_;

&#x20; std::unique\_ptr<MockServiceA> mock\_service\_a\_;

&#x20; std::unique\_ptr<MockServiceB> mock\_service\_b\_;



&#x20; // Target object being tested

&#x20; std::unique\_ptr<TargetClass> target\_object\_;

};



} // namespace \[namespace]

```



\### 10.2 Public Method Tests



```cpp

// For each public method - objects are already initialized in SetUp()

TEST\_F(TargetClassTest, PublicMethod\_SuccessCase) {

&#x20; // TESTING: target\_object\_->PublicMethod() implementation

&#x20; // NOT TESTING: External service implementations (they are mocked)



&#x20; // Arrange: Set up specific mock expectations for this test

&#x20; EXPECT\_CALL(\*mock\_service\_a\_, ProcessData(\_))

&#x20;     .WillOnce(Return(expected\_result));



&#x20; // Act: Call the PUBLIC method being tested

&#x20; auto result = target\_object\_->PublicMethod(input\_data);



&#x20; // Assert: Verify the target method's behavior

&#x20; EXPECT\_EQ(expected\_result, result);

&#x20; EXPECT\_TRUE(target\_object\_->GetInternalState());

}



// TEST TARGET: TargetClass::PublicMethod() error handling

TEST\_F(TargetClassTest, PublicMethod\_ErrorCase) {

&#x20; // Configure mock to simulate error condition

&#x20; EXPECT\_CALL(\*mock\_service\_a\_, ProcessData(\_))

&#x20;     .WillOnce(Return(std::nullopt));  // Simulate failure



&#x20; // Test error handling in target method

&#x20; auto result = target\_object\_->PublicMethod(input\_data);



&#x20; // Verify target object handles error correctly

&#x20; EXPECT\_FALSE(result.has\_value());

&#x20; EXPECT\_FALSE(target\_object\_->GetInternalState());

}

```



\### 10.3 Private Method Tests



```cpp

// For each private method (using friend access) - reuse existing objects

TEST\_F(TargetClassTest, PrivateMethod\_Logic) {

&#x20; // TESTING: Private business logic in target file

&#x20; // ACCESS: Via friend access, NOT inheritance



&#x20; // Set up mocks for private method dependencies

&#x20; EXPECT\_CALL(\*mock\_service\_b\_, ValidateInput(\_))

&#x20;     .WillOnce(Return(true));



&#x20; // Call PRIVATE method directly via friend access

&#x20; bool result = target\_object\_->PrivateMethod(test\_input);



&#x20; // Verify private method's internal logic

&#x20; EXPECT\_TRUE(result);

&#x20; EXPECT\_EQ(expected\_internal\_state, target\_object\_->GetInternalValue());

}

```



\### 10.4 Static Method Testing



```cpp

// TEST TARGET: TargetClass::StaticMethod() in {target\_file}.cc

// TESTING APPROACH: Direct call to static method, mock internal dependencies

TEST\_F(TargetClassTest, StaticMethod\_CalculationLogic) {

&#x20; // TESTING: The actual static method implementation

&#x20; // NOT MOCKING: The static method itself (test real implementation)



&#x20; // If static method has dependencies, inject mocks

&#x20; MockHelperClass mock\_helper;

&#x20; TargetClass::SetHelperForTesting(\&mock\_helper);



&#x20; EXPECT\_CALL(mock\_helper, Calculate(\_))

&#x20;     .WillOnce(Return(42));



&#x20; // Call STATIC method directly

&#x20; int result = TargetClass::StaticMethod(input\_value);



&#x20; // Verify static method's calculation/logic

&#x20; EXPECT\_EQ(expected\_calculation, result);

}

```



\### 10.5 Observer/Callback Method Testing



```cpp

// TEST TARGET: TargetClass::OnSomeEvent() in {target\_file}.cc

TEST\_F(TargetClassTest, OnSomeEvent\_HandlesNotification) {

&#x20; // TESTING: Observer method response in target object



&#x20; // Set up expectation for what target should do when notified

&#x20; EXPECT\_CALL(\*mock\_service\_a\_, UpdateState(\_))

&#x20;     .WillOnce(Return(true));



&#x20; // Trigger the OBSERVER method being tested

&#x20; target\_object\_->OnSomeEvent(event\_data);



&#x20; // Verify target object's response to the event

&#x20; EXPECT\_TRUE(target\_object\_->IsEventProcessed());

}

```



\### 10.6 Protected Method Testing via Inheritance



```cpp

// TEST TARGET: TargetClass::ProtectedMethod() in {target\_file}.cc

TEST\_F(TargetClassInheritanceTest, ProtectedMethod\_InternalLogic) {

&#x20; // TESTING: Protected method implementation in target file

&#x20; // ACCESS: Via inheritance, testing the actual implementation



&#x20; auto result = test\_target\_->ProtectedMethod(input);

&#x20; EXPECT\_EQ(expected, result);

}

```



\---



\## 11. Build Integration Templates



\### 11.1 Build Target Classification Rules



\- `//components/\*` → `components\_unittests`

\- `//chrome/\*` → `unit\_tests`

\- `//content/\*` → `content\_unittests`

\- `//services/\*` → `services\_unittests`



\### 11.2 Local Test Target Update



```gn

\# Add to existing source\_set or create new one

source\_set("unit\_tests") {

&#x20; testonly = true

&#x20; sources = \[

&#x20;   # ...existing sources...

&#x20;   "\[new\_test\_file].cc",

&#x20; ]

&#x20; deps = \[

&#x20;   # Copy deps from main target

&#x20;   # Add test-specific deps

&#x20;   "//testing/gtest",

&#x20;   "//testing/gmock",

&#x20; ]

}

```



\### 11.3 BUILD\_edge.gni Update



```gn

\# In BUILD\_edge.gni

source\_set("edge\_overlay\_test\_unit\_tests") {

&#x20; deps = \[

&#x20;   # ...existing deps...

&#x20;   "\[local\_test\_target\_path]:unit\_tests",

&#x20; ]

}

```



\### 11.4 Top-Level BUILD.gn Update



```gn

\# In top-level BUILD.gn

test("\[top\_level\_target]") {

&#x20; deps = \[

&#x20;   # ...existing deps...

&#x20;   "\[local\_test\_target\_path]:unit\_tests",

&#x20; ]

}

```



\---



\## 12. Implementation Checklist



\### 12.1 Before Starting



\- \[ ] Read haystack.instructions.md for search tool guidelines

\- \[ ] Limit HaystackSearch to maximum 5 results per query

\- \[ ] Search in same directory first, then expand



\### 12.2 Analysis Phase



\- \[ ] Use read\_file to completely read target file

\- \[ ] Identify all public methods and their purposes

\- \[ ] Search for existing test patterns in same directory

\- \[ ] Check for async operations, observers, or external dependencies

\- \[ ] Understand error handling and edge cases



\### 12.3 Test Creation Phase



\- \[ ] Check if test file already exists (foo\_unittest.cc)

\- \[ ] Use appropriate test base class for component type

\- \[ ] \*\*CRITICAL\*\*: Initialize test environment ONCE in SetUp() method

\- \[ ] \*\*CRITICAL\*\*: Use setter injection for all mock dependencies

\- \[ ] Create test cases: happy path, edge cases, error conditions

\- \[ ] Add proper mock objects for external dependencies

\- \[ ] Include histogram verification if component logs metrics

\- \[ ] Reset the external dependencies if test cases needed

\- \[ ] Init objects not in cases to maintain state across test cases



\### 12.4 Build Integration Phase



\- \[ ] Find nearest BUILD.gn file from target file directory

\- \[ ] Look for existing test targets (unit\_tests, unittests)

\- \[ ] Add test file to appropriate source\_set

\- \[ ] Copy dependencies from component being tested

\- \[ ] Check for BUILD\_edge.gni in top-level test directory

\- \[ ] Add local test target to top-level test target deps



\### 12.5 Build and Test Phase



\- \[ ] Use mcp\_edge\_ut\_build\_target to build top-level target

\- \[ ] Wait for build completion and read full output

\- \[ ] Fix any build errors (missing includes, dependencies)

\- \[ ] Use mcp\_edge\_ut\_run\_tests with specific test filter

\- \[ ] Wait for test completion and analyze results

\- \[ ] Fix test failures and re-run until all pass



\### 12.6 Quality Verification



\- \[ ] Ensure all public methods have test coverage

\- \[ ] Verify tests are stable and not flaky

\- \[ ] Check that tests follow Chromium naming conventions

\- \[ ] Confirm build has no warnings

\- \[ ] Validate async operations complete properly

\- \[ ] \*\*CRITICAL\*\*: Verify mock objects use setter injection pattern

\- \[ ] \*\*CRITICAL\*\*: Confirm test environment initialized only once

\- \[ ] \*\*CRITICAL\*\*: Validate object state persistence across test cases

\- \[ ] \*\*CRITICAL\*\*: Check proper mock expectation cleanup between tests



\### 12.7 Context Cleanup



\- \[ ] Remove analysis context from conversation

\- \[ ] Ensure clean state for next test generation



\---



\## 13. Advanced Problem Prevention Strategies



\### 13.1 Feature Flag Discovery and Management



\#### 13.1.1 Feature Flag Search Commands

```bash

\# Use haystackSearch to find feature flags affecting your class

haystackSearch("kMyFeature features::")

haystackSearch("MyClassName feature")

haystackSearch("MyClassName scoped\_feature\_list")

```



\#### 13.1.2 Feature Flag Default State Analysis

```cpp

// Search for feature flag definition to understand default state

// Look for patterns like:

BASE\_FEATURE(kMyFeature, "MyFeature", base::FEATURE\_DISABLED\_BY\_DEFAULT);

BASE\_FEATURE(kMyFeature, "MyFeature", base::FEATURE\_ENABLED\_BY\_DEFAULT);



// Common feature flag issues:

// 1. Feature disabled by default but required for functionality

// 2. Multiple feature flags affecting same code path

// 3. Feature flag checked in constructor vs method level

```



\### 13.2 Service Factory Pattern Recognition



\#### 13.2.1 Service Factory Search Commands

```bash

\# Find service factory patterns

haystackSearch("MyServiceFactory GetInstance")

haystackSearch("MyService SetTestingFactory")

haystackSearch("MyService SetServiceIsNullWhileTesting")

```



\#### 13.2.2 Service Injection Pattern Analysis

```cpp

// Common service factory patterns to look for:



// Pattern 1: Service returns nullptr in tests by default

SomeServiceFactory::GetInstance()->SetServiceIsNullWhileTesting(true);  // Default

SomeServiceFactory::GetInstance()->SetServiceIsNullWhileTesting(false); // For testing



// Pattern 2: Service factory replacement

SomeServiceFactory::GetInstance()->SetTestingFactory(

&#x20;   profile, base::BindRepeating(\&CreateMockService));



// Pattern 3: Direct service replacement

target\_->SetServiceForTesting(mock\_service.get());

```



\### 13.3 Observer Pattern Lifecycle Management



\#### 13.3.1 Observer Registration Search

```bash

\# Find observer patterns

haystackSearch("AddObserver RemoveObserver")

haystackSearch("MyClassName Observer")

haystackSearch("Observer OnSomethingChanged")

```



\#### 13.3.2 Observer Lifecycle Issues Prevention

```cpp

// Common observer issues and prevention:



// Issue: Observer not removed in destructor

// Prevention: Check for RemoveObserver calls in target class destructor



// Issue: Observer called multiple times during setup

// Prevention: Use AtLeast(1) for observer method expectations

EXPECT\_CALL(\*mock\_observer\_, OnEvent(testing::\_))

&#x20;   .Times(testing::AtLeast(1));



// Issue: Observer lifecycle order

// Prevention: Add/Remove observers in correct order

class MyTargetClass {

&#x20; void SetUp() {

&#x20;   service\_->AddObserver(this);  // Add first

&#x20;   InitializeOtherStuff();       // Then initialize

&#x20; }



&#x20; void TearDown() {

&#x20;   CleanupOtherStuff();          // Cleanup first

&#x20;   service\_->RemoveObserver(this); // Remove last

&#x20; }

};

```



\### 13.4 Async Operation and Callback Management



\#### 13.4.1 Async Pattern Search Commands

```bash

\# Find async patterns

haystackSearch("base::OnceCallback base::RepeatingCallback")

haystackSearch("MyClassName Callback Completed")

haystackSearch("TestFuture RunUntilIdle")

```



\#### 13.4.2 Async Testing Pattern Templates

```cpp

// Pattern 1: Simple async callback testing

TEST\_F(MyClassTest, AsyncMethod\_CompletesSuccessfully) {

&#x20; base::test::TestFuture<bool> future;



&#x20; target\_->DoAsyncOperation(future.GetCallback());



&#x20; EXPECT\_TRUE(future.Get());  // Blocks until callback is called

}



// Pattern 2: Multiple async operations

TEST\_F(MyClassTest, MultipleAsyncOperations\_AllComplete) {

&#x20; base::test::TestFuture<bool> future1;

&#x20; base::test::TestFuture<std::string> future2;



&#x20; target\_->DoAsyncOp1(future1.GetCallback());

&#x20; target\_->DoAsyncOp2(future2.GetCallback());



&#x20; EXPECT\_TRUE(future1.Get());

&#x20; EXPECT\_EQ("expected", future2.Get());

}



// Pattern 3: Testing async failure scenarios

TEST\_F(MyClassTest, AsyncMethod\_HandlesFailure) {

&#x20; base::test::TestFuture<bool, std::string> future;



&#x20; // Set up failure conditions

&#x20; EXPECT\_CALL(\*mock\_service\_, DoSomething())

&#x20;     .WillOnce(testing::Return(false));



&#x20; target\_->DoAsyncOperation(future.GetCallback());



&#x20; auto \[success, error\_msg] = future.Get();

&#x20; EXPECT\_FALSE(success);

&#x20; EXPECT\_NE("", error\_msg);

}

```



\### 13.5 Mock Expectation Management



\#### 13.5.1 Mock Reset and Cleanup Patterns

```cpp

class MyTargetClassTest : public testing::Test {

&#x20;protected:

&#x20; void ResetAllMockExpectations() {

&#x20;   // Clear expectations without destroying objects

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_service1\_.get());

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_service2\_.get());

&#x20;   testing::Mock::VerifyAndClearExpectations(mock\_observer\_.get());



&#x20;   // Reset any state that mocks might have changed

&#x20;   task\_environment\_.RunUntilIdle();

&#x20; }



&#x20; void SetUpCommonMockBehavior() {

&#x20;   // Set up default behaviors that most tests expect

&#x20;   ON\_CALL(\*mock\_service1\_, GetSomething())

&#x20;       .WillByDefault(testing::Return("default\_value"));

&#x20;   ON\_CALL(\*mock\_service2\_, IsReady())

&#x20;       .WillByDefault(testing::Return(true));

&#x20; }

};



// Use in individual tests

TEST\_F(MyTargetClassTest, SomeMethod\_SpecificScenario) {

&#x20; ResetAllMockExpectations();

&#x20; SetUpCommonMockBehavior();



&#x20; // Test-specific expectations

&#x20; EXPECT\_CALL(\*mock\_service1\_, DoSpecificThing())

&#x20;     .WillOnce(testing::Return(expected\_result));



&#x20; // Execute test

&#x20; auto result = target\_->SomeMethod();



&#x20; // Verify

&#x20; EXPECT\_EQ(expected\_result, result);

}

```



\### 13.6 Build System Integration Prevention



\#### 13.6.1 Build Target Discovery Commands

```bash

\# Find build targets

haystackFiles("BUILD.gn" workspace)

haystackSearch("unit\_tests source\_set")

haystackSearch("unittests testonly")

```



\#### 13.6.2 Common Build Integration Issues Prevention

```cpp

// Issue: Test file added to wrong target

// Prevention: Follow directory-based target mapping

// //chrome/\* → unit\_tests

// //components/\* → components\_unittests

// //content/\* → content\_unittests



// Issue: Missing dependencies

// Prevention: Add all required deps for test

deps = \[

&#x20; ":target\_under\_test",

&#x20; "//base/test:test\_support",

&#x20; "//testing/gmock",

&#x20; "//testing/gtest",

&#x20; // Add any specific service factories or mocks

]



// Issue: Circular dependencies

// Prevention: Ensure test target doesn't create cycles

// Test should depend on target, not vice versa

```



