Feature: Signing in

  Scenario: Signing in through the form
    Given I am on the "/login" page
    When I fill in "Username" with "admin"
    And I fill in "Password" with "admin"
    And I click "Sign in"
    Then I should be on the "/dashboard" page
    And I should see "Welcome, Ada Admin."

  Scenario: Rejected credentials
    Given I am on the "/login" page
    When I fill in "Username" with "admin"
    And I fill in "Password" with "wrong"
    And I click "Sign in"
    Then I should see "Those credentials were not recognised."

  # Exercises the `loginAs` fixture and the `authenticate` hook in
  # playwright.config.ts, rather than driving the form by hand.
  Scenario: The shared admin login fixture
    Given I am logged in as an admin
    When I navigate to "/dashboard"
    Then I should see "Signed in as Administrator."

  Scenario: The shared login fixture for a named role
    Given I am logged in as "viewer"
    When I navigate to "/dashboard"
    Then I should see "Signed in as Viewer."
