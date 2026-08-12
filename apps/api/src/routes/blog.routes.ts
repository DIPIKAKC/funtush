import { upload } from "@funtush/storage";
import { Router } from "express";
import { createBlog, createcategory, getAgencyBlogs, getAgencycategories, updateBlog, updatecategory } from "src/controllers/blog.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

router.route('/agencies/me/categories')
    .get(authenticateWithRefreshToken, getAgencycategories)
    .post(authenticateWithRefreshToken, createcategory);

router.route('/agencies/me/categories/:id')
    .patch(authenticateWithRefreshToken, updatecategory)

router.route('/agencies/me/blogs')
    .get(authenticateWithRefreshToken, getAgencyBlogs)
    .post(authenticateWithRefreshToken, upload.array("photos", 10), createBlog);
    

router.route('/agencies/me/blogs/:id')
    .patch(authenticateWithRefreshToken, upload.array("photos", 10), updateBlog)

export default router;
