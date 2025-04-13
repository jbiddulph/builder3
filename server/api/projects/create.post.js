// server/api/createProject.post.js
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { title, description, repo_name, github_username, image, category, status, userId } = body

  // Validate required fields
  if (!repo_name) {
    throw createError({ 
      statusCode: 400, 
      message: 'repo_name is required' 
    })
  }

  // Ensure userId is provided (from Supabase user or auth)
  if (!userId) {
    throw createError({ 
      statusCode: 401, 
      message: 'User not authenticated' 
    })
  }

  try {
    // Check if the user exists in Prisma, or create a new record if not
    let user = await prisma.user.findFirst({
      where: { loggedInId: userId.toString() },
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          loggedInId: userId.toString(),
        },
      })
    }

    // Create the new website project associated with the user
    const website = await prisma.websites.create({
      data: {
        title: title || 'New Project',
        description: description || '',
        repo_name,
        github_username,
        image: image || "/img/websites/holding.png",
        category: category || "new project",
        status: status || "NEW",
        userId: user.id,
      },
    })

    return website
  } catch (error) {
    console.error('Error creating website:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to create website',
      cause: error
    })
  }
})
