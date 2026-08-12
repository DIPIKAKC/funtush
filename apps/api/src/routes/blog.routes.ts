import { Router } from "express";
import { createcategory, getAgencycategories, updatecategory } from "src/controllers/blog.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";

const router = Router();

router.route('/agencies/me/categories')
    .get(authenticateWithRefreshToken, getAgencycategories)
    .post(authenticateWithRefreshToken, createcategory);

router.route('/agencies/me/categories/:id')
    .patch(authenticateWithRefreshToken, updatecategory)

router.route('/agencies/me/blogs')
    .get(authenticateWithRefreshToken,)
    .post(authenticateWithRefreshToken,);

router.route('/agencies/me/blogs/:id')
    .patch(authenticateWithRefreshToken,)

export default router;
