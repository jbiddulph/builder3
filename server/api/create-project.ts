import { defineEventHandler, readBody } from "h3";
import { execSync } from "child_process";
import axios, { AxiosError } from "axios";
import fs from "fs";
import * as path from "path";
const config = useRuntimeConfig();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || config.githubUser;

export default defineEventHandler(async (event) => {
  const { modules } = await readBody(event);
  const projectName = `nuxt-app-${Date.now()}`;
  const projectDir = path.join("/tmp", projectName);

  // Log the GitHub username being used
  console.log("Using GitHub username:", GITHUB_USERNAME);

  try {
    const gitVersion = execSync('git --version').toString();
    console.log('Git is available:', gitVersion);
    // Step 1: Create new Nuxt app
    console.log("Creating a new Nuxt application...");
    execSync(`npx nuxi@latest init ${projectDir}`);
    console.log("Nuxt application created successfully.");

    // Step 2: Add selected modules
    if (modules && modules.length) {
      for (const module of modules) {
        console.log(`Adding module: ${module}`);
        execSync(`npx nuxi@latest module add ${module}`, { cwd: projectDir });
      }
      console.log("Modules added successfully.");
    }

    // Step 3: Initialize Git repository
    console.log("Initializing Git repository...");
    execSync(`git config --global user.email ${process.env.GITHUB_EMAIL}`, { cwd: projectDir });
    execSync(`git config --global user.name ${process.env.GITHUB_NAME}`, { cwd: projectDir });
    execSync("git init", { cwd: projectDir });
    execSync("git checkout -b main", { cwd: projectDir });
    execSync("git add .", { cwd: projectDir });
    execSync(`git commit -m "Initial commit with selected modules"`, { cwd: projectDir });
    execSync(`git branch -M main`, { cwd: projectDir });
    console.log("Git repository initialized and initial commit made.");

    // Step 4: Create GitHub repo and get HTTPS URL
    console.log("Creating GitHub repository...");
    const repoResponse = await axios.post(
      `https://api.github.com/user/repos`,
      { name: projectName, private: true },
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } }
    );

    // const githubRepoUrl = repoResponse.data.clone_url;
    // console.log("GitHub repository created:", githubRepoUrl);

    // Step 5: Set remote to HTTPS and push code to GitHub
    const githubRepoUrl = `https://github.com/${GITHUB_USERNAME}/${projectName}.git`;
    const sshGitHubRepoUrl = `git@github.com:${GITHUB_USERNAME}/${projectName}.git`;
    console.log("Using GitHub URL:", githubRepoUrl);  // Check the URL
    try {
        // Add the remote
        execSync(`git remote add origin ${sshGitHubRepoUrl}`, { cwd: projectDir });
    
        // Push the code
        execSync("git push -u origin main", { cwd: projectDir });
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error("Error setting remote or pushing code:", error.message);
        }
    }
    // Add the remote
    // execSync(`git remote add origin ${githubRepoUrl}`, { cwd: projectDir });


    // Push the code
    // execSync("git push -u origin main", { cwd: projectDir });
    console.log("Code pushed to GitHub successfully on main branch.");

    // Add a delay to ensure GitHub repository is ready
    console.log("Waiting for GitHub repository to be fully available...");
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay

    // Step 6: Use Netlify API to create and link the site
    console.log("Linking GitHub repository to Netlify...");
    
    // Verify the GitHub repository exists and is accessible
    try {
      const repoCheckResponse = await axios.get(
        `https://api.github.com/repos/${GITHUB_USERNAME}/${projectName}`,
        { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } }
      );
      console.log("GitHub repository is ready:", repoCheckResponse.data.full_name);
    } catch (error) {
      console.error("GitHub repository not ready yet, waiting longer...");
      await new Promise(resolve => setTimeout(resolve, 5000)); // Additional 5 second delay
    }

    console.log("Using Netlify token:", process.env.NETLIFY_TOKEN ? "Token is present" : "Token is missing");
    
    const netlifyResponse = await axios.post(
      "https://api.netlify.com/api/v1/sites",
      {
        name: projectName,
        repo: {
          provider: "github",
          repo: `${GITHUB_USERNAME}/${projectName}`,
          branch: "main",
          private: true
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Netlify site created:", netlifyResponse.data);
    const siteId = netlifyResponse.data.id;
    console.log("Netlify site ID:", siteId);

    // Step 7: Create a deploy hook for the Netlify site
    console.log("Creating deploy hook for Netlify site...");
    const deployHookURL = await createDeployHook(siteId);

    if (deployHookURL) {
      console.log("Deploy hook created:", deployHookURL);
      // Optionally trigger deployment immediately
      await axios.post(deployHookURL);
      console.log("Deployment triggered via deploy hook.");
    }

    console.log("Deployment to Netlify successful:", netlifyResponse.data.url);
    return { 
      netlify_url: netlifyResponse.data.url,
      site_id: siteId,
      repo_name: `${GITHUB_USERNAME}/${projectName}`,  // Include the full repo path
      github_username: GITHUB_USERNAME
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Git is not available:', error.message);
      console.error("Error creating and deploying project:", error.message, error.stack);

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          console.error("Error response status:", axiosError.response.status);
          console.error("Error response headers:", axiosError.response.headers);
          console.error("Error response data:", axiosError.response.data);
        }
      }

      return { 
        statusCode: 500, 
        message: "Failed to create and deploy project.", 
        error: error.message 
      };
    }
    return { 
      statusCode: 500, 
      message: "Failed to create and deploy project.", 
      error: "Unknown error occurred" 
    };
  }

  async function createDeployHook(siteId: string) {
    const hookName = 'Auto Deploy Hook';
  
    try {
      const response = await axios.post(
        `https://api.netlify.com/api/v1/sites/${siteId}/build_hooks`,
        {
          type: 'url',
          event: 'deploy',
          name: hookName,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
  
      if (!response.data || !response.data.url) {
        console.error("Deploy hook response missing URL:", response.data);
        return null;
      }
  
      console.log("Deploy hook created successfully:", response.data);
      return response.data.url;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Failed to create deploy hook:", 
          axios.isAxiosError(error) ? error.response?.data : error.message
        );
        if (axios.isAxiosError(error) && error.response) {
          console.error("Full error response:", {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          });
        }
      }
      return null;
    }
  }
});
