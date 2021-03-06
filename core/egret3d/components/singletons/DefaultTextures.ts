namespace egret3d {
    /**
     * 默认的贴图。
     */
    export class DefaultTextures extends paper.SingletonComponent {
        /**
         * 
         */
        public static WHITE: Texture;
        /**
         * 
         */
        public static GRAY: Texture;
        /**
         * 
         */
        public static GRID: Texture;
        /**
         * 
         */
        public static MISSING: Texture;

        public initialize() {
            {
                const texture = GLTexture2D.createColorTexture("builtin/white.image.json", 255, 255, 255);
                texture._isBuiltin = true;
                DefaultTextures.WHITE = texture;
                paper.Asset.register(texture);
            }

            {
                const texture = GLTexture2D.createColorTexture("builtin/gray.image.json", 128, 128, 128);
                texture._isBuiltin = true;
                DefaultTextures.GRAY = texture;
                paper.Asset.register(texture);
            }

            {
                const texture = GLTexture2D.createGridTexture("builtin/grid.image.json");
                texture._isBuiltin = true;
                DefaultTextures.GRID = texture;
                paper.Asset.register(texture);
            }

            {
                const texture = GLTexture2D.createColorTexture("builtin/missing.image.json", 255, 0, 255);
                texture._isBuiltin = true;
                DefaultTextures.MISSING = texture;
                paper.Asset.register(texture);
            }           
        }
    }
}
