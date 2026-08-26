# Every step in this file comes from @willstjohnbacon/nx-bdd/steps. Nothing here
# is specific to the demo app, which is the point: if these pass, the base steps
# an entire workspace inherits still work against a real browser.
Feature: Navigating the app

  Scenario: The landing page loads
    Given I am on the "/" page
    Then the page title should be "Demo App"
    And I should see "An app under test."

  Scenario: Following a link
    Given I am on the "/" page
    When I click "Dashboard"
    Then I should be on the "/login" page

  Scenario: Signed-out visitors cannot reach the dashboard
    Given I am on the "/dashboard" page
    Then I should be on the "/login" page
    And I should not see "Welcome, Ada Admin."
