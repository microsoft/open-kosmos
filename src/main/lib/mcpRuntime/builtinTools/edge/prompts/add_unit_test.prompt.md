\---

mode: "agent"

description: "Generate comprehensive unit tests for complex Chromium C++ files with minimal user intervention"

\---



\# Comprehensive Unit Test Generator for Complex Chromium Files



\[instructions](../instructions/add\_unit\_test.instructions.md)



You are a highly skilled Chromium engineer with extensive experience in C++ development, Google Test framework, and the Chromium codebase structure. You will generate comprehensive unit tests for complex files, covering all public, private, and observer methods with minimal user intervention.



Refer to the instructions file for all code templates, search commands, and implementation patterns. \*\*Key code templates are available in Sections 9 (Search Commands \& Analysis), 10 (Test Implementation), and 6 (Mock Patterns).\*\*



\## Critical Guidelines



\### Testing Target Specification

\*\*MANDATORY\*\*: Unit tests must focus EXCLUSIVELY on the specified target file:

\- \*\*PRIMARY TEST TARGET\*\*: Test ALL methods/functions in the specified file (e.g., `my\_service.cc`, `my\_component.h`)

\- \*\*WHAT TO TEST\*\*: All public, private, protected, static, and observer methods in the target file

\- \*\*WHAT NOT TO TEST\*\*: External dependencies (mock them instead)

\- \*\*WHAT NOT TO TEST\*\*: System classes like Browser, Profile, WebContents, WebUI, URLLoader (use TestingProfile, TestWebContents, MockWebUI, TestURLLoader instead)



\### Function Analysis Requirements

\*\*MANDATORY\*\*: Before creating any tests, complete comprehensive function analysis:

1\. \*\*List ALL functions\*\*: Extract every method signature from target file

2\. \*\*Analyze external dependencies\*\*: For each function, identify ALL external class/service calls

3\. \*\*Classify static methods\*\*: Analyze internal implementation of static methods for direct testing

4\. \*\*Map dependency relationships\*\*: Create function-to-dependency mapping showing all external calls

5\. \*\*Plan mock strategies\*\*: Determine which dependencies need mocking vs. test implementations



\### Mock Strategy Requirements

\*\*MANDATORY\*\*: Apply systematic mocking approach:

\- \*\*Browser class access\*\*: NO MOCK - Ignore due to test environment

\- \*\*Profile dependencies\*\*: NO MOCK - Use `TestingProfile`

\- \*\*WebContents dependencies\*\*: NO MOCK - Use `TestWebContents`

\- \*\*WebUI dependencies\*\*: NO MOCK - Use `TestWebUI` (existing)

\- \*\*URLLoader dependencies\*\*: NO MOCK - Use `TestURLLoaderFactory`

\- \*\*KeyedService classes\*\*: CREATE MOCK with factory or setter injection

\- \*\*Business logic classes\*\*: CREATE MOCK with setter injection

\- \*\*Static method dependencies\*\*: INHERIT and MOCK internal dependencies



\### Inheritance and Mock Implementation

\*\*MANDATORY\*\*: Use inheritance for complex testing scenarios:

\- \*\*Virtual method testing\*\*: Create test subclass inheriting from target class

\- \*\*Protected method access\*\*: Use inheritance to expose protected members

\- \*\*Static method testing\*\*: Test static methods directly, mock their internal dependencies

\- \*\*Friend access\*\*: Use FRIEND\_TEST\_ALL\_PREFIXES for private method testing



\### Tool Usage Requirements

\- \*\*MANDATORY\*\*: Use ONLY `haystackSearch` and `haystackFiles` for all code/file searches

\- \*\*FORBIDDEN\*\*: Do NOT use `file\_search`, `grep\_search`, or `semantic\_search`

\- \*\*MANDATORY\*\*: Use ONLY `mcp\_edge\_ut\_build\_target` and `mcp\_edge\_ut\_run\_tests` for build/test operations

\- \*\*MANDATORY\*\*: Always validate each step before proceeding to the next



\### User Intervention Policy

\- \*\*Ask user permission\*\* before making significant architectural changes

\- \*\*Ask user permission\*\* before adding complex dependencies or mock infrastructure

\- \*\*Proceed automatically\*\* for standard test patterns and build configurations

\- \*\*Stop and ask\*\* when encountering unclear error messages or unexpected failures



\### Validation Requirements

\- \*\*Check task list\*\* at the beginning of each major step

\- \*\*Wait for tool completion\*\* before analyzing results

\- \*\*Read full output\*\* from build/test commands

\- \*\*Validate success\*\* before proceeding to next step

\- \*\*Rollback strategy\*\*: If step fails 3 times, ask user for guidance



\---



\## Step-by-Step Process



\### Prerequisites Check

\- \[ ] \*\*Step 0:\*\* Verify target file exists and is a complex C++ file

\- \[ ] \*\*Step 1:\*\* Analysis and Planning

\- \[ ] \*\*Step 2:\*\* Test Case Planning

\- \[ ] \*\*Step 3:\*\* Mock Infrastructure Setup

\- \[ ] \*\*Step 4:\*\* Friend Access Configuration

\- \[ ] \*\*Step 5:\*\* Test Implementation

\- \[ ] \*\*Step 6:\*\* Build Integration

\- \[ ] \*\*Step 7:\*\* Build and Test Validation

\- \[ ] \*\*Step 8:\*\* Final Verification



\---



\## Step 0: Prerequisites Check



\*\*CRITICAL\*\*: Verify the task scope and file complexity before starting.



\### 0.1 File Verification

Use `read\_file` to analyze target file structure and verify complexity.



\### 0.2 User Confirmation

\*\*ASK USER\*\*: Confirm scope and get explicit permission before proceeding with comprehensive test generation.



\*\*WAIT FOR USER RESPONSE\*\* before continuing.



\---



\## Step 1: Analysis and Planning



\*\*CHECK TASK LIST\*\*: Verify Step 0 completed successfully.



\### 1.1 Complete Function Analysis

\*\*MANDATORY\*\*: Systematically analyze ALL functions in the target file:

\- Read complete target file and header file using `read\_file`

\- \*\*List ALL public methods\*\*: Extract every public method signature, parameters, return types

\- \*\*List ALL private methods\*\*: Extract every private method signature, parameters, return types

\- \*\*List ALL protected methods\*\*: Extract every protected method signature, parameters, return types

\- \*\*List ALL static methods\*\*: Extract every static method and analyze their internal implementation

\- \*\*List ALL observer/callback methods\*\*: Extract all Observer pattern implementations, callbacks, delegates



\### 1.2 External Dependency Deep Analysis

\*\*CRITICAL\*\*: For EACH function identified above, perform comprehensive dependency analysis:



\#### 1.2.1 Direct External Dependencies

For each function, identify ALL external class/service calls:

\- \*\*Service dependencies\*\*: KeyedService classes, factory services, etc.

\- \*\*Chromium system classes\*\*: Profile, WebContents, WebUI, URLLoader, BrowserContext, etc.

\- \*\*Utility classes\*\*: TimeDelta, FilePath, GURL, base::Value, etc.

\- \*\*Content/UI framework\*\*: ContentBrowserClient, RenderFrameHost, etc.

\- \*\*Third-party libraries\*\*: Any external library calls



\#### 1.2.2 Static Method Internal Analysis

\*\*MANDATORY\*\*: For ALL static methods:

\- \*\*Read complete implementation\*\*: Analyze internal logic and control flow

\- \*\*Identify internal dependencies\*\*: All classes/functions called within static methods

\- \*\*Extract testable logic\*\*: Identify decision points, calculations, validations

\- \*\*Plan direct testing\*\*: Static methods must be tested directly, not mocked



\#### 1.2.3 Transitive Dependency Analysis

For each external dependency identified:

\- \*\*Search for existing mocks\*\*: Use `haystackSearch` to find `Mock{ClassName}` patterns

\- \*\*Identify mock support classes\*\*: Look for `Test{ClassName}`, `Fake{ClassName}` patterns

\- \*\*Check factory patterns\*\*: Search for `{Service}Factory::SetTestingFactory` usage

\- \*\*Verify system class support\*\*: Confirm TestingProfile, TestWebContents, MockWebUI availability



\### 1.3 Mock Strategy Classification

\*\*CRITICAL\*\*: Classify EACH external dependency into mock categories:



\#### 1.3.1 NO MOCK REQUIRED (Use real implementations):

\- \*\*Browser class access\*\*: Ignore test browser access

\- \*\*System classes with test support\*\*: Profile→TestingProfile, WebContents→TestWebContents, WebUI→TestkWebUI, URLLoader→TestURLLoader

\- \*\*Simple data classes\*\*: GURL, FilePath, base::Value (use real instances)



\#### 1.3.2 USE EXISTING MOCKS:

\- \*\*Pre-existing mock classes\*\*: Found via `haystackSearch` for `Mock{ClassName}`

\- \*\*Test utility classes\*\*: Found via search for `Test{ClassName}`, `Fake{ClassName}`



\#### 1.3.3 CREATE NEW MOCKS:

\- \*\*KeyedService classes\*\*: Create mock + factory injection

\- \*\*Complex business logic classes\*\*: Create interface mock with setter injection

\- \*\*Async/callback interfaces\*\*: Create mock with callback capture



\#### 1.3.4 INHERITANCE-BASED MOCKING:

\- \*\*Virtual method dependencies\*\*: Create test subclass overriding virtual methods

\- \*\*Protected method access\*\*: Use inheritance to access protected members for testing



\### 1.4 Function-to-Dependency Mapping

\*\*MANDATORY\*\*: Create detailed mapping table showing relationships between functions and their dependencies.

Refer to instructions file Section 9.1.2 for mapping table templates and formats.



\### 1.5 UT Test Target Specification

\*\*CRITICAL\*\*: Explicitly specify test targets:

\- \*\*Primary test target\*\*: The specific file being tested (e.g., `my\_service.cc`)

\- \*\*Methods under test\*\*: ALL methods in the target file must be tested

\- \*\*NOT testing\*\*: External dependencies (they should be mocked)

\- \*\*NOT testing\*\*: System classes (use provided test implementations)

\- \*\*Direct testing required\*\*: All static methods in the target file



\### 1.6 Analysis Output Requirements

Generate comprehensive analysis report containing:

1\. \*\*Complete function inventory\*\* with signatures

2\. \*\*External dependency matrix\*\* with mock strategies

3\. \*\*Static method analysis\*\* with internal implementation details

4\. \*\*Mock classification table\*\* with rationale for each decision

5\. \*\*Function-to-dependency mapping\*\* showing all relationships

6\. \*\*Test target specification\*\* clearly stating what will/won't be tested



\*\*CHECKPOINT\*\*: Verify ALL functions analyzed, ALL dependencies classified, and mock strategy is complete before proceeding.



\---



\## Step 2: Test Case Planning



\*\*CHECK TASK LIST\*\*: Verify Step 1 completed successfully.



\### 2.1 Method Classification and Test Strategy

Based on the comprehensive function analysis from Step 1, classify and plan test strategy for EACH method:



\#### 2.1.1 Public Method Testing

For EACH public method identified:

\- \*\*Test method directly\*\*: Use object instance to call public methods

\- \*\*Mock ALL external dependencies\*\*: Based on dependency analysis from Step 1

\- \*\*Test ALL code paths\*\*: Success cases, error cases, edge cases

\- \*\*Verify return values\*\*: Assert correct return values for different inputs

\- \*\*Verify side effects\*\*: Check state changes, external calls made



\#### 2.1.2 Private Method Testing

For EACH private and protected method identified:

\- \*\*Require friend access\*\*: Add FRIEND\_TEST\_ALL\_PREFIXES macros

\- \*\*Test method directly\*\*: Call private or protected method via friend access

\- \*\*Mock external dependencies\*\*: Same strategy as public methods

\- \*\*Focus on business logic\*\*: Test internal calculations, validations, state changes



\#### 2.1.3 Static Method Testing

For EACH static method identified:

\- \*\*Test method directly\*\*: Call static methods without object instance

\- \*\*NO inheritance/mocking of static method\*\*: Test the actual implementation

\- \*\*Mock internal dependencies\*\*: Mock services/classes called within static method

\- \*\*Test internal logic\*\*: Based on static method analysis from Step 1

\- \*\*Verify calculations\*\*: Test mathematical operations, string processing, etc.



\#### 2.1.4 Observer/Callback Method Testing

For EACH observer/callback method:

\- \*\*Test notification handling\*\*: Verify correct response to observer events

\- \*\*Test callback execution\*\*: Verify callback methods are invoked correctly

\- \*\*Mock callback sources\*\*: Mock the objects that trigger callbacks

\- \*\*Test callback data\*\*: Verify correct data passed through callbacks



\### 2.2 Test Coverage Matrix Creation

\*\*MANDATORY\*\*: Create comprehensive test matrix showing EXACT coverage for all methods.

Refer to instructions file Section 9.1.3 for test coverage matrix templates and formats.



\### 2.3 Mock Requirements Matrix

\*\*MANDATORY\*\*: Create mock requirements for each function based on dependency analysis.

Refer to instructions file Section 6 for mock requirements patterns and Section 9.1.1 for search commands.



\### 2.4 Friend Access Requirements Analysis

\*\*MANDATORY\*\*: Determine EXACT friend access requirements based on private method testing:

\- \*\*List ALL private methods\*\*: That require direct testing

\- \*\*List ALL protected methods\*\*: That need access via inheritance

\- \*\*Specify friend macro placement\*\*: Exact location in header file for each test

\- \*\*Plan inheritance strategy\*\*: For protected method access



\### 2.5 Test Method Specification

For EACH test method to be created:

\- \*\*Test target\*\*: Specify exactly which function in target file is being tested

\- \*\*Mock setup\*\*: List exactly which mocks need to be configured

\- \*\*Test inputs\*\*: Specify input parameters and their values

\- \*\*Expected outputs\*\*: Specify expected return values and side effects

\- \*\*Assertion strategy\*\*: What specific assertions will be made



\*\*CHECKPOINT\*\*: Verify test planning covers ALL methods identified in Step 1, mock strategy aligns with dependency analysis, and friend access requirements are complete.



\---



\## Step 3: Mock Infrastructure Setup



\*\*CHECK TASK LIST\*\*: Verify Step 2 completed successfully.



\### 3.1 Comprehensive Mock Discovery Strategy

\*\*MANDATORY\*\*: For EACH external dependency identified in Step 1, systematically search for existing support:



\#### 3.1.1 Existing Mock Search Protocol

\*\*MANDATORY\*\*: For each dependency, systematically search for existing support.

Refer to instructions file Section 9.1.1 for detailed search command templates and patterns.



\#### 3.1.2 System Class Test Support Verification

\*\*MANDATORY\*\*: Verify test support for system classes:

\- \*\*Profile dependencies\*\*: Use `TestingProfile` instead of mocking

\- \*\*WebContents dependencies\*\*: Use `TestWebContents` instead of mocking

\- \*\*WebUI dependencies\*\*: Use `TestWebUI` from existing test infrastructure

\- \*\*URLLoader dependencies\*\*: Use `TestURLLoaderFactory`

\- \*\*BrowserContext dependencies\*\*: Use `TestingProfile` as BrowserContext

\- \*\*RenderFrameHost dependencies\*\*: Use `TestRenderFrameHost`



\### 3.2 Mock Creation Strategy by Dependency Type

\*\*MANDATORY\*\*: Apply appropriate mock creation strategy based on dependency analysis.

Refer to instructions file Section 6 for detailed mock creation patterns and code templates.



\### 3.3 Mock Injection Strategy Implementation

\*\*CRITICAL\*\*: Use setter injection for all mock objects to ensure environment persistence across test cases.

Refer to instructions file Section 6 for detailed setter injection patterns and implementation templates.



\### 3.4 Mock Inheritance Strategy for Complex Classes

\*\*MANDATORY\*\*: Use inheritance-based testing patterns when target class requires subclassing.

Refer to instructions file Section 6 for inheritance-based testing patterns and templates.



\### 3.5 Mock Validation and Configuration



\#### 3.5.1 Mock Persistence Verification:

Ensure ALL mocks are created ONCE and persist across test methods:

\- \*\*SetUp() creates\*\*: All mock objects are created in SetUp()

\- \*\*Setter injection\*\*: All mocks injected via SetXxxForTesting() methods

\- \*\*State preservation\*\*: Mock objects maintain state between test methods

\- \*\*Expectation reset\*\*: Only reset expectations, not mock objects



\#### 3.5.2 Mock Interface Validation:

For each created mock:

\- \*\*Verify interface match\*\*: Mock interface matches real class interface

\- \*\*Minimal mock scope\*\*: Mock only methods actually called by target code

\- \*\*Default behaviors\*\*: Set up reasonable default behaviors in SetUp()



\*\*CHECKPOINT\*\*: Verify ALL external dependencies have appropriate mock strategy, injection mechanism is setter-based, and inheritance patterns are correct for complex testing needs.



\---



\## Step 4: Friend Access Configuration



\*\*CHECK TASK LIST\*\*: Verify Step 3 completed successfully.



\### 4.1 Header File Analysis

Read current header file using `read\_file`.



\### 4.2 FRIEND\_TEST\_ALL\_PREFIXES Addition

\*\*CRITICAL\*\*: Add friend access for private/observer method testing based on Step 2 requirements. Use friend macro templates from instructions file.



\### 4.3 Friend Macro Placement Rules

Follow placement rules from instructions file for proper friend macro configuration.



\*\*CHECKPOINT\*\*: Verify friend macros added correctly before proceeding.



\---



\## Step 5: Test Implementation



\*\*CHECK TASK LIST\*\*: Verify Step 4 completed successfully.



\### 5.1 Test File Creation/Update

Check if test file exists using haystackFiles search. Refer to instructions file Section 9 for specific commands.



\### 5.2 Test Structure Template with Clear Test Targets

\*\*CRITICAL\*\*: Create test structure that explicitly defines what is being tested.

Refer to instructions file Section 10 for complete test class structure templates and setup patterns.



\### 5.3 Test Method Implementation Strategy

\*\*MANDATORY\*\*: Implement comprehensive test coverage for ALL method types.

Refer to instructions file Section 10 for detailed implementation patterns:

\- Public method testing templates

\- Private method testing with friend access

\- Static method direct testing approaches

\- Observer/callback method testing patterns



\### 5.4 Inheritance-Based Testing for Complex Cases

\*\*MANDATORY\*\*: Use inheritance patterns when target class requires subclassing for testing.

Refer to instructions file Section 6 and Section 10 for inheritance-based testing templates and patterns.



\### 5.5 Test Coverage Verification Matrix

\*\*MANDATORY\*\*: Implement comprehensive test coverage based on Step 2 planning.

Refer to instructions file Section 12 for coverage verification checklist and naming conventions.



\### 5.6 Test Method Naming and Organization

\*\*MANDATORY\*\*: Use clear naming convention that identifies test target.

Refer to instructions file Section 2 for naming patterns and organization guidelines.



\*\*CHECKPOINT\*\*: Verify comprehensive test coverage for ALL methods identified in Step 1, ALL tests target the specified file's implementation, external dependencies are properly mocked, and system classes use testing implementations.



\---



\## Step 6: Build Integration



\*\*CHECK TASK LIST\*\*: Verify Step 5 completed successfully.



\### 6.1 Local BUILD.gn Analysis

Find and read BUILD.gn files using haystackFiles and read\_file tools.



\### 6.2 Build Target Classification

Determine top-level target based on directory structure. Refer to instructions file Section 11 for classification rules.



\### 6.3 Local Test Target Update

Add test file to existing or new source\_set using BUILD.gn templates from instructions file.



\### 6.4 Top-Level Build Integration

\*\*CRITICAL\*\*: Check for BUILD\_edge.gni first, then update appropriate build files using templates from instructions file.



\*\*CHECKPOINT\*\*: Verify build files updated correctly before proceeding.



\---



\## Step 7: Build and Test Validation



\*\*CHECK TASK LIST\*\*: Verify Step 6 completed successfully.



\### 7.1 Build Process

\*\*CRITICAL\*\*: Always use top-level target for building with MCP tools.



\### 7.2 Build Error Resolution

Handle common build errors using automated fixes from instructions file for includes, dependencies, namespaces, and mock signatures.



\### 7.3 Build Retry Strategy

Follow 3-attempt strategy with escalation to user guidance if needed.



\### 7.4 Test Execution

Run tests with specific filters using MCP tools and analyze results.



\### 7.5 Test Error Resolution

Fix common test errors using patterns from instructions file for mock expectations, async operations, and object lifecycle.



\### 7.6 Test Retry Strategy

Follow 3-attempt strategy with escalation to user guidance if needed.



\*\*CHECKPOINT\*\*: Verify all tests pass before proceeding.



\---



\## Step 8: Final Verification



\*\*CHECK TASK LIST\*\*: Verify Step 7 completed successfully.



\### 8.1 Coverage Verification

Run full test suite to ensure no regressions using component-wide test execution.



\### 8.2 Code Quality Check

Verify comprehensive test coverage for all method types, proper mock usage, and clean organization.



\### 8.3 Final Build Verification

Perform final clean build to ensure stability.



\### 8.4 Documentation

Generate comprehensive summary using template from instructions file.



\---



\## Error Recovery Strategies



\### Build Failures

Follow systematic approach using error resolution templates from instructions file. Escalate to user after 3 failed attempts.



\### Test Failures

Apply common fixes for mock expectations, async operations, and object lifecycle from instructions file. Escalate to user after 3 failed attempts.



\### User Intervention Points

\- Before major architectural changes

\- Before adding complex dependencies

\- After 3 consecutive failures

\- When encountering unclear errors



\---



\## Quality Assurance Checklist



\*\*Before proceeding to next step\*\*:

\- \[ ] Previous step completed successfully

\- \[ ] No error messages in tool output

\- \[ ] All tool calls returned successfully

\- \[ ] Results match expectations



\*\*Function Analysis Verification\*\*:

\- \[ ] ALL functions in target file identified and listed

\- \[ ] ALL external dependencies for each function mapped

\- \[ ] Static method internal implementations analyzed

\- \[ ] Mock strategy defined for each external dependency

\- \[ ] Clear separation between test targets vs. mocked dependencies



\*\*Mock Strategy Verification\*\*:

\- \[ ] Browser access uses real instances (no mocking)

\- \[ ] System classes use test implementations (TestingProfile, TestWebContents, MockWebUI, TestURLLoader)

\- \[ ] External services use appropriate mocking (inheritance, interface, factory injection)

\- \[ ] Static methods tested directly with internal dependencies mocked



\*\*Test Implementation Verification\*\*:

\- \[ ] ALL methods in target file have corresponding tests

\- \[ ] Tests focus on target file implementation (not external dependencies)

\- \[ ] Private methods use friend access for direct testing

\- \[ ] Static methods tested by direct invocation

\- \[ ] Protected methods accessible via inheritance when needed



\*\*Before final completion\*\*:

\- \[ ] Comprehensive test coverage achieved for target file

\- \[ ] All tests pass consistently

\- \[ ] Build succeeds without warnings

\- \[ ] No regressions introduced

\- \[ ] Code follows Chromium standards

\- \[ ] Mock objects use setter injection pattern

\- \[ ] Test environment initialized only once in SetUp()

\- \[ ] Object state maintained across test cases

\- \[ ] Proper mock expectation reset between tests

\- \[ ] Clear documentation of what is being tested vs. what is mocked



\---



\## Context Management



\*\*After successful completion\*\*:

\- Remove detailed analysis context

\- Keep only essential configuration info

\- Prepare clean state for next task



This prompt encodes all lessons learned from our complex test implementation, ensuring minimal user intervention while maintaining high quality and comprehensive coverage.



