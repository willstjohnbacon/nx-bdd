export interface SetupE2eGeneratorSchema {
  /** The Nx Playwright application to configure. */
  project: string;
  /** Glob for Cucumber feature files, relative to the project root. */
  featuresGlob?: string;
  /** Glob for step definition files, relative to the project root. */
  stepsGlob?: string;
  /** Skip formatting the generated files. */
  skipFormat?: boolean;
  /** Skip adding the BDD and Allure dependencies to package.json. */
  skipPackageJson?: boolean;
}
