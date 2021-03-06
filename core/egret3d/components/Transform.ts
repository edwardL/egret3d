namespace egret3d {
    const _helpVector3 = Vector3.create();
    const _helpRotation = Quaternion.create();
    const _helpMatrix = Matrix4.create();

    const enum TransformDirty {
        PRS = 0b00111,

        Position = 0b00001,
        Rotation = 0b00010,
        Scale = 0b00100,

        Euler = 0b01000,
        Matrix = 0b10000,
    }
    /**
     * 变换组件。
     * - 实现实体之间的父子关系。
     * - 实现 3D 空间坐标系。
     */
    export class Transform extends paper.BaseComponent {
        private _localDirty: TransformDirty = TransformDirty.PRS | TransformDirty.Euler | TransformDirty.Matrix;
        private _worldDirty: TransformDirty = TransformDirty.PRS | TransformDirty.Euler | TransformDirty.Matrix;
        /**
         * 世界矩阵的行列式，如果小于0，说明进行了反转
         * @internal
         */
        public _worldMatrixDeterminant: number = 0.0;

        @paper.serializedField("localPosition")
        private readonly _localPosition: Vector3 = Vector3.create();
        @paper.serializedField("localRotation")
        private readonly _localRotation: Quaternion = Quaternion.create();
        private readonly _localEuler: Vector3 = Vector3.create();
        private readonly _localEulerAngles: Vector3 = Vector3.create();
        @paper.serializedField("localScale")
        private readonly _localScale: Vector3 = Vector3.ONE.clone();
        private readonly _localMatrix: Matrix4 = Matrix4.create();

        private readonly _position: Vector3 = Vector3.create();
        private readonly _rotation: Quaternion = Quaternion.create();
        private readonly _euler: Vector3 = Vector3.create();
        private readonly _eulerAngles: Vector3 = Vector3.create();
        private readonly _scale: Vector3 = Vector3.ONE.clone();
        /**
         * TODO inverse world matrix.
         */
        private readonly _worldMatrix: Matrix4 = Matrix4.create();
        /**
         * @internal
         */
        public readonly _children: Transform[] = [];
        /**
         * @internal
         */
        public _parent: Transform | null = null;

        private _removeFromChildren(value: Transform) {
            let index = 0;
            for (const child of this._children) {
                if (child === value) {
                    this._children.splice(index, 1);
                    break;
                }

                index++;
            }
        }

        private _dirtify(isLocalDirty: ConstrainBoolean, dirty: TransformDirty) {
            if (isLocalDirty) {
                this._localDirty |= dirty | TransformDirty.Matrix;

                if (dirty & TransformDirty.Rotation) {
                    this._localDirty |= TransformDirty.Scale;
                    this._localDirty |= TransformDirty.Euler;
                }
                else if (dirty & TransformDirty.Scale) {
                    this._localDirty |= TransformDirty.Rotation;
                }
            }

            if (!(this._worldDirty & dirty) || !(this._worldDirty & TransformDirty.Matrix)) {
                if (dirty & TransformDirty.Position) {
                    this._worldDirty |= dirty | TransformDirty.Matrix;
                }
                else {
                    this._worldDirty |= TransformDirty.PRS | TransformDirty.Euler | TransformDirty.Matrix;
                }

                for (const child of this._children) {
                    child._dirtify(false, dirty);
                }

                if (this.gameObject.renderer) { // TODO
                    this.gameObject.renderer._boundingSphereDirty = true;
                }
            }
        }

        private _updateMatrix(isWorldSpace: boolean) {
            if (isWorldSpace) {
                const localMatrix = this.localMatrix;

                if (this._parent) {
                    this._worldMatrix.multiply(this._parent.worldMatrix, localMatrix);
                }
                else {
                    this._worldMatrix.copy(localMatrix);
                }

                this._worldMatrixDeterminant = this._worldMatrix.determinant();
                this._worldDirty &= ~TransformDirty.Matrix;
            }
            else {
                if ((this._localDirty & TransformDirty.Rotation) || (this._localDirty & TransformDirty.Scale)) {
                    this._localMatrix.compose(this.localPosition, this.localRotation, this.localScale);
                    this._localDirty &= ~TransformDirty.PRS;
                }
                else if (this._localDirty & TransformDirty.Position) {
                    this._localMatrix.fromTranslate(this.localPosition, true);
                    this._localDirty &= ~TransformDirty.Position;
                }

                this._localDirty &= ~TransformDirty.Matrix;
            }
        }

        private _updateEuler(isWorldSpace: boolean, order?: EulerOrder) {
            if (isWorldSpace) {
                this.worldMatrix.toEuler(this._euler, order);
                this._eulerAngles.multiplyScalar(RAD_DEG, this._euler);
                this._worldDirty &= ~TransformDirty.Euler;
            }
            else {
                this.localMatrix.toEuler(this._localEuler, order);
                this._localEulerAngles.multiplyScalar(RAD_DEG, this._localEuler);
                this._localDirty &= ~TransformDirty.Euler;
            }
        }

        protected _onParentChange(newParent: Transform | null, oldParent: Transform | null) {
            const prevActive = oldParent ? oldParent.gameObject.activeInHierarchy : this.gameObject.activeSelf;
            if ((newParent ? newParent.gameObject.activeInHierarchy : this.gameObject.activeSelf) !== prevActive) {
                this.gameObject._activeInHierarchyDirty(prevActive);
            }

            this._dirtify(false, TransformDirty.PRS);
        }
        /**
         * @internal
         */
        public getAllChildren(out: Transform[] | { [key: string]: Transform | (Transform[]) } = []) {
            for (const child of this._children) {
                if (Array.isArray(out)) {
                    out.push(child);
                }
                else {
                    const childName = child.gameObject.name;
                    if (childName in out) {
                        const transformOrTransforms = out[childName];
                        if (Array.isArray(transformOrTransforms)) {
                            transformOrTransforms.push(child);
                        }
                        else {
                            out[childName] = [transformOrTransforms, child];
                        }
                    }
                    else {
                        out[childName] = child;
                    }
                }

                child.getAllChildren(out);
            }

            return out;
        }
        /**
         * 销毁所有子（孙）级变换组件。
         */
        public destroyChildren() {
            let i = this._children.length;
            while (i--) {
                this._children[i].gameObject.destroy();
            }
        }
        /**
         * 该组件是否包含指定的子（孙）级变换组件。
         */
        public contains(value: Transform): boolean {
            if (value === this) {
                return false;
            }

            let ancestor: Transform | null = value;
            while (ancestor !== this && ancestor !== null) {
                ancestor = ancestor.parent;
            }

            return ancestor === this;
        }
        /**
         * 设置该组件实体的父级变换组件。
         * @param value 父级变换组件。
         * @param worldPositionStays 是否保留当前世界空间坐标系的位置。
         */
        public setParent(value: Transform | null, worldPositionStays: boolean = false) {
            const prevParent = this._parent;
            if (prevParent === value) {
                return this;
            }

            if (
                value &&
                this.gameObject.scene !== value.gameObject.scene
            ) {
                console.warn("Cannot change the parent to a different scene.");
                return this;
            }

            if (this === value || (value && this.contains(value))) {
                console.error("Set the parent error.");
                return this;
            }

            if (worldPositionStays) {
                _helpVector3.copy(this.position);
            }

            if (prevParent) {
                prevParent._removeFromChildren(this);
            }

            if (value) {
                value._children.push(this);
            }

            this._parent = value;
            this._onParentChange(value, prevParent);

            if (worldPositionStays) {
                this.position = _helpVector3;
            }

            return this;
        }
        /**
         * 
         */
        public getChildIndex(value: Transform) {
            if (value.parent !== this) {
                return -1;
            }

            return this._children.indexOf(value);
        }
        /**
         * 
         */
        public setChildIndex(value: Transform, index: number) {
            if (value.parent !== this) {
                return;
            }

            const prevIndex = this._children.indexOf(value);
            if (prevIndex === index) {
                return;
            }

            this._children.splice(prevIndex, 1);
            this._children.splice(index, 0, value);
        }
        /**
         * 
         */
        public getChildAt(index: number) {
            return 0 <= index && index < this._children.length ? this._children[index] : null;
        }
        /**
         * 通过指定的名称或路径获取该组件实体的子级（孙级）变换组件。
         * @param nameOrPath 名称或路径。
         */
        public find(nameOrPath: string) {
            const names = nameOrPath.split("/");
            let ancestor: Transform = this;

            for (const name of names) {
                if (!name) {
                    return ancestor;
                }

                const prevAncestor = ancestor;
                for (const child of ancestor._children) {
                    if (child.gameObject.name === name) {
                        ancestor = child;
                        break;
                    }
                }

                if (prevAncestor === ancestor) {
                    return null;
                }
            }

            return ancestor;
        }
        /**
         * 该物体的本地位置。
         */
        public getLocalPosition(): Readonly<Vector3> {
            return this._localPosition;
        }
        /**
         * 该物体的本地位置。
         */
        public setLocalPosition(position: Readonly<IVector3>): this;
        public setLocalPosition(x: number, y: number, z: number): this;
        public setLocalPosition(p1: Readonly<IVector3> | number, p2?: number, p3?: number) {
            if (p1.hasOwnProperty("x")) {
                this._localPosition.x = (p1 as Readonly<IVector3>).x;
                this._localPosition.y = (p1 as Readonly<IVector3>).y;
                this._localPosition.z = (p1 as Readonly<IVector3>).z;
            }
            else {
                this._localPosition.x = p1 as number;
                this._localPosition.y = p2 || 0.0;
                this._localPosition.z = p3 || 0.0;
            }

            this._dirtify(true, TransformDirty.Position);

            return this;
        }
        /**
         * 该物体的本地位置。
         */
        @paper.editor.property(paper.editor.EditType.VECTOR3)
        public get localPosition(): Readonly<Vector3 | IVector3> {
            return this._localPosition;
        }
        public set localPosition(value: Readonly<Vector3 | IVector3>) {
            this._localPosition.x = value.x;
            this._localPosition.y = value.y;
            this._localPosition.z = value.z;

            this._dirtify(true, TransformDirty.Position);
        }
        /**
         * 该物体的本地旋转。
         */
        public getLocalRotation(): Readonly<Quaternion> {
            return this._localRotation;
        }
        /**
         * 该物体的本地旋转。
         */
        public setLocalRotation(rotation: Readonly<IVector4>): this;
        public setLocalRotation(x: number, y: number, z: number, w: number): this;
        public setLocalRotation(p1: Readonly<IVector4> | number, p2?: number, p3?: number, p4?: number) {
            if (p1.hasOwnProperty("x")) {
                this._localRotation.x = (p1 as Readonly<IVector3>).x;
                this._localRotation.y = (p1 as Readonly<IVector3>).y;
                this._localRotation.z = (p1 as Readonly<IVector3>).z;
                this._localRotation.w = (p1 as Readonly<IVector4>).w;
            }
            else {
                this._localRotation.x = p1 as number;
                this._localRotation.y = p2 || 0.0;
                this._localRotation.z = p3 || 0.0;
                this._localRotation.w = p4 !== undefined ? p4 : 1.0;
            }

            this._dirtify(true, TransformDirty.Rotation);

            return this;
        }
        /**
         * 该物体的本地旋转。
         */
        public get localRotation(): Readonly<Quaternion | IVector4> {
            return this._localRotation;
        }
        public set localRotation(value: Readonly<Quaternion | IVector4>) {
            this._localRotation.x = value.x;
            this._localRotation.y = value.y;
            this._localRotation.z = value.z;
            this._localRotation.w = value.w;

            this._dirtify(true, TransformDirty.Rotation);
        }
        /**
         * 该物体的本地欧拉弧度。
         */
        public getLocalEuler(order?: EulerOrder): Readonly<Vector3> {
            if (this._localDirty & TransformDirty.Euler) {
                this._updateEuler(false, order);
            }

            return this._localEuler;
        }
        /**
         * 该物体的本地欧拉弧度。
         */
        public setLocalEuler(value: Readonly<IVector3>, order?: EulerOrder): this;
        public setLocalEuler(x: number, y: number, z: number, order?: EulerOrder): this;
        public setLocalEuler(p1: Readonly<IVector3> | number, p2?: EulerOrder | number, p3?: number, p4?: EulerOrder) {
            if (p1.hasOwnProperty("x")) {
                this._localEuler.x = (p1 as Readonly<IVector3>).x;
                this._localEuler.y = (p1 as Readonly<IVector3>).y;
                this._localEuler.z = (p1 as Readonly<IVector3>).z;
                this._localEulerAngles.multiplyScalar(RAD_DEG, this._localEuler);
                this._localRotation.fromEuler(this._localEuler, p2 as EulerOrder);
            }
            else {
                this._localEuler.x = p1 as number;
                this._localEuler.y = p2 as number;
                this._localEuler.z = p3 as number;
                this._localEulerAngles.multiplyScalar(RAD_DEG, this._localEuler);
                this._localRotation.fromEuler(this._localEuler, p4 as EulerOrder);
            }

            this._dirtify(true, TransformDirty.Rotation);
            this._localDirty &= ~TransformDirty.Euler;

            return this;
        }
        /**
         * 该物体的本地欧拉弧度。
         */
        public get localEuler(): Readonly<Vector3 | IVector3> {
            if (this._localDirty & TransformDirty.Euler) {
                this._updateEuler(false);
            }

            return this._localEuler;
        }
        public set localEuler(value: Readonly<Vector3 | IVector3>) {
            this._localEuler.x = value.x;
            this._localEuler.y = value.y;
            this._localEuler.z = value.z;
            this._localEulerAngles.multiplyScalar(RAD_DEG, this._localEuler);
            this._localRotation.fromEuler(this._localEuler);
            this._dirtify(true, TransformDirty.Rotation);
            this._localDirty &= ~TransformDirty.Euler;
        }
        /**
         * 该物体的本地欧拉角度。
         */
        public getLocalEulerAngles(order?: EulerOrder): Readonly<Vector3> {
            if (this._localDirty & TransformDirty.Euler) {
                this._updateEuler(false, order);
            }

            return this._localEulerAngles;
        }
        /**
         * 该物体的本地欧拉角度。
         */
        public setLocalEulerAngles(value: Readonly<IVector3>, order?: EulerOrder): this;
        public setLocalEulerAngles(x: number, y: number, z: number, order?: EulerOrder): this;
        public setLocalEulerAngles(p1: Readonly<IVector3> | number, p2?: EulerOrder | number, p3?: number, p4?: EulerOrder) {
            if (p1.hasOwnProperty("x")) {
                this._localEulerAngles.x = (p1 as Readonly<IVector3>).x;
                this._localEulerAngles.y = (p1 as Readonly<IVector3>).y;
                this._localEulerAngles.z = (p1 as Readonly<IVector3>).z;
                this._localEuler.multiplyScalar(DEG_RAD, this._localEulerAngles);
                this._localRotation.fromEuler(this._localEuler, p2 as EulerOrder);
            }
            else {
                this._localEulerAngles.x = p1 as number;
                this._localEulerAngles.y = p2 as number;
                this._localEulerAngles.z = p3 as number;
                this._localEuler.multiplyScalar(DEG_RAD, this._localEulerAngles);
                this._localRotation.fromEuler(this._localEuler, p4 as EulerOrder);
            }

            this._dirtify(true, TransformDirty.Rotation);
            this._localDirty &= ~TransformDirty.Euler;

            return this;
        }
        /**
         * 该物体的本地欧拉角度。
         */
        @paper.editor.property(paper.editor.EditType.VECTOR3, { step: 1.0 })
        public get localEulerAngles(): Readonly<Vector3 | IVector3> {
            if (this._localDirty & TransformDirty.Euler) {
                this._updateEuler(false);
            }

            return this._localEulerAngles;
        }
        public set localEulerAngles(value: Readonly<Vector3 | IVector3>) {
            this._localEulerAngles.x = value.x;
            this._localEulerAngles.y = value.y;
            this._localEulerAngles.z = value.z;
            this._localEuler.multiplyScalar(DEG_RAD, this._localEulerAngles);
            this._localRotation.fromEuler(this._localEuler);
            this._dirtify(true, TransformDirty.Rotation);
            this._localDirty &= ~TransformDirty.Euler;
        }
        /**
         * 该物体的本地缩放。
         */
        public getLocalScale(): Readonly<Vector3> {
            return this._localScale;
        }
        /**
         * 该物体的本地缩放。
         */
        public setLocalScale(v: Readonly<IVector3>): this;
        public setLocalScale(x: number, y?: number, z?: number): this;
        public setLocalScale(p1: Readonly<IVector3> | number, p2?: number, p3?: number) {
            if (p1.hasOwnProperty("x")) {
                this._localScale.x = (p1 as Readonly<IVector3>).x;
                this._localScale.y = (p1 as Readonly<IVector3>).y;
                this._localScale.z = (p1 as Readonly<IVector3>).z;
            }
            else {
                this._localScale.x = p1 as number;
                this._localScale.y = p2 !== undefined ? p2 : p1 as number;
                this._localScale.z = p3 !== undefined ? p3 : p1 as number;
            }

            this._dirtify(true, TransformDirty.Scale);

            return this;
        }
        /**
         * 该物体的本地缩放。
         */
        @paper.editor.property(paper.editor.EditType.VECTOR3)
        public get localScale(): Readonly<Vector3 | IVector3> {
            return this._localScale;
        }
        public set localScale(value: Readonly<Vector3 | IVector3>) {
            this._localScale.x = value.x;
            this._localScale.y = value.y;
            this._localScale.z = value.z;

            this._dirtify(true, TransformDirty.Scale);
        }
        /**
         * 该物体的本地矩阵。
         */
        public getLocalMatrix(): Readonly<Matrix4> {
            if (this._localDirty & TransformDirty.Matrix) {
                this._updateMatrix(false);
            }

            return this._localMatrix;
        }
        /**
         * 该物体的本地矩阵。
         */
        public get localMatrix(): Readonly<Matrix4> {
            if (this._localDirty & TransformDirty.Matrix) {
                this._updateMatrix(false);
            }

            return this._localMatrix;
        }
        /**
         * 该物体的世界位置。
         */
        public getPosition(): Readonly<Vector3> {
            if (this._worldDirty & TransformDirty.Position) {
                this.worldMatrix.decompose(this._position, null, null);
                this._worldDirty &= ~TransformDirty.Position;
            }

            return this._position;
        }
        /**
         * 该物体的世界位置。
         */
        public setPosition(position: Readonly<IVector3>): this;
        public setPosition(x: number, y: number, z: number): this;
        public setPosition(p1: Readonly<IVector3> | number, p2?: number, p3?: number) {
            if (p1.hasOwnProperty("x")) {
                this._localPosition.x = (p1 as Readonly<IVector3>).x;
                this._localPosition.y = (p1 as Readonly<IVector3>).y;
                this._localPosition.z = (p1 as Readonly<IVector3>).z;
            }
            else {
                this._localPosition.x = p1 as number;
                this._localPosition.y = p2 || 0.0;
                this._localPosition.z = p3 || 0.0;
            }

            if (this._parent) {
                this._localPosition.applyMatrix(_helpMatrix.inverse(this._parent.worldMatrix));
            }

            this._dirtify(true, TransformDirty.Position);

            return this;
        }
        /**
         * 该物体的世界位置。
         */
        public get position(): Readonly<Vector3 | IVector3> {
            if (this._worldDirty & TransformDirty.Position) {
                this.worldMatrix.decompose(this._position, null, null);
                this._worldDirty &= ~TransformDirty.Position;
            }

            return this._position;
        }
        public set position(value: Readonly<Vector3 | IVector3>) {
            this._localPosition.x = value.x;
            this._localPosition.y = value.y;
            this._localPosition.z = value.z;

            if (this._parent) {
                this._localPosition.applyMatrix(_helpMatrix.inverse(this._parent.worldMatrix));
            }

            this._dirtify(true, TransformDirty.Position);
        }
        /**
         * 该物体的世界旋转。
         */
        public getRotation(): Readonly<Quaternion> {
            if (this._worldDirty & TransformDirty.Rotation) {
                this.worldMatrix.decompose(null, this._rotation, null);
                this._worldDirty &= ~TransformDirty.Rotation;
            }

            return this._rotation;
        }
        /**
         * 该物体的世界旋转。
         */
        public setRotation(v: Readonly<IVector4>): this;
        public setRotation(x: number, y: number, z: number, w: number): this;
        public setRotation(p1: Readonly<IVector4> | number, p2?: number, p3?: number, p4?: number) {
            if (p1.hasOwnProperty("x")) {
                this._localRotation.x = (p1 as Readonly<IVector3>).x;
                this._localRotation.y = (p1 as Readonly<IVector3>).y;
                this._localRotation.z = (p1 as Readonly<IVector3>).z;
                this._localRotation.w = (p1 as Readonly<IVector4>).w;
            }
            else {
                this._localRotation.x = p1 as number;
                this._localRotation.y = p2 || 0.0;
                this._localRotation.z = p3 || 0.0;
                this._localRotation.w = p4 !== undefined ? p4 : 1.0;
            }

            if (this._parent) {
                this._localRotation.premultiply(_helpRotation.inverse(this._parent.rotation)).normalize();
            }

            this._dirtify(true, TransformDirty.Rotation);

            return this;
        }
        /**
         * 该物体的世界旋转。
         */
        public get rotation(): Readonly<Quaternion | IVector4> {
            if (this._worldDirty & TransformDirty.Rotation) {
                this.worldMatrix.decompose(null, this._rotation, null);
                this._worldDirty &= ~TransformDirty.Rotation;
            }

            return this._rotation;
        }
        public set rotation(value: Readonly<Quaternion | IVector4>) {
            this._localRotation.x = value.x;
            this._localRotation.y = value.y;
            this._localRotation.z = value.z;
            this._localRotation.w = value.w;

            if (this._parent) {
                this._localRotation.premultiply(_helpRotation.inverse(this._parent.rotation)).normalize();
            }

            this._dirtify(true, TransformDirty.Rotation);
        }
        /**
         * 该物体的世界欧拉弧度。
         */
        public getEuler(order?: EulerOrder): Readonly<Vector3> {
            if (this._worldDirty & TransformDirty.Euler) {
                this._updateEuler(true, order);
            }

            return this._euler;
        }
        /**
         * 该物体的世界欧拉弧度。
         */
        public setEuler(v: Readonly<IVector3>, order?: EulerOrder): this;
        public setEuler(x: number, y: number, z: number, order?: EulerOrder): this;
        public setEuler(q1: Readonly<IVector3> | number, q2?: EulerOrder | number, q3?: number, q4?: EulerOrder) {
            if (q1.hasOwnProperty("x")) {
                this._localRotation.fromEuler(q1 as Readonly<IVector3>, q2 as EulerOrder);
            }
            else {
                _helpVector3.set(q1 as number, q2 as number, q3 as number);
                this._localRotation.fromEuler(_helpVector3, q4 as EulerOrder);
            }

            if (this._parent) {
                this._localRotation.premultiply(_helpRotation.inverse(this._parent.rotation)).normalize();
            }

            this._dirtify(true, TransformDirty.Rotation);

            return this;
        }
        /**
         * 该物体的世界欧拉弧度。
         */
        public get euler(): Readonly<Vector3 | IVector3> {
            if (this._worldDirty & TransformDirty.Euler) {
                this._updateEuler(true);
            }

            return this._euler;
        }
        public set euler(value: Readonly<Vector3 | IVector3>) {
            this._localRotation.fromEuler(value);

            if (this._parent) {
                this._localRotation.premultiply(_helpRotation.inverse(this._parent.rotation)).normalize();
            }

            this._dirtify(true, TransformDirty.Rotation);
        }
        /**
         * 该物体的世界欧拉角度。
         */
        public getEulerAngles(order?: EulerOrder): Readonly<Vector3> {
            if (this._worldDirty & TransformDirty.Euler) {
                this._updateEuler(true, order);
            }

            return this._eulerAngles;
        }
        /**
         * 该物体的世界欧拉角度。
         */
        public setEulerAngles(v: Readonly<IVector3>, order?: EulerOrder): this;
        public setEulerAngles(x: number, y: number, z: number, order?: EulerOrder): this;
        public setEulerAngles(q1: Readonly<IVector3> | number, q2?: EulerOrder | number, q3?: number, q4?: EulerOrder) {
            if (q1.hasOwnProperty("x")) {
                _helpVector3.multiplyScalar(DEG_RAD, q1 as Readonly<IVector3>);
                this._localRotation.fromEuler(_helpVector3, q2 as EulerOrder);
            }
            else {
                _helpVector3.set(q1 as number * DEG_RAD, q2 as number * DEG_RAD, q3 as number * DEG_RAD);
                this._localRotation.fromEuler(_helpVector3, q4 as EulerOrder);
            }

            if (this._parent) {
                this._localRotation.premultiply(_helpRotation.inverse(this._parent.rotation)).normalize();
            }

            this._dirtify(true, TransformDirty.Rotation);

            return this;
        }
        /**
         * 该物体的世界欧拉角度。
         */
        public get eulerAngles(): Readonly<Vector3 | IVector3> {
            if (this._worldDirty & TransformDirty.Euler) {
                this._updateEuler(true);
            }

            return this._eulerAngles;
        }
        public set eulerAngles(value: Readonly<Vector3 | IVector3>) {
            _helpVector3.multiplyScalar(DEG_RAD, value);
            this._localRotation.fromEuler(_helpVector3);

            if (this._parent) {
                this._localRotation.premultiply(_helpRotation.inverse(this._parent.rotation)).normalize();
            }

            this._dirtify(true, TransformDirty.Rotation);
        }
        /**
         * 该物体的世界缩放。
         */
        public getScale(): Readonly<Vector3> {
            if (this._worldDirty & TransformDirty.Scale) {
                this.worldMatrix.decompose(null, null, this._scale);
                this._worldDirty &= ~TransformDirty.Scale;
            }

            return this._scale;
        }
        /**
         * 该物体的世界缩放。
         */
        public setScale(v: Readonly<IVector3>): this;
        public setScale(x: number, y?: number, z?: number): this;
        public setScale(p1: Readonly<IVector3> | number, p2?: number, p3?: number) {
            if (p1.hasOwnProperty("x")) {
                this._localScale.x = (p1 as Readonly<IVector3>).x;
                this._localScale.y = (p1 as Readonly<IVector3>).y;
                this._localScale.z = (p1 as Readonly<IVector3>).z;
            }
            else {
                this._localScale.x = p1 as number;
                this._localScale.y = p2 !== undefined ? p2 : p1 as number;
                this._localScale.z = p3 !== undefined ? p3 : p1 as number;
            }

            if (this._parent) {
                this._localScale.applyDirection(_helpMatrix.inverse(this._parent.worldMatrix));
            }

            this._dirtify(true, TransformDirty.Scale);

            return this;
        }
        /**
         * 该物体的世界缩放。
         */
        public get scale(): Readonly<Vector3 | IVector3> {
            if (this._worldDirty & TransformDirty.Scale) {
                this.worldMatrix.decompose(null, null, this._scale);
                this._worldDirty &= ~TransformDirty.Scale;
            }

            return this._scale;
        }
        public set scale(value: Readonly<Vector3 | IVector3>) {
            this._localScale.x = value.x;
            this._localScale.y = value.y;
            this._localScale.z = value.z;

            if (this._parent) {
                this._localScale.applyDirection(_helpMatrix.inverse(this._parent.worldMatrix));
            }

            this._dirtify(true, TransformDirty.Scale);
        }
        /**
         * 该物体的世界矩阵。
         */
        public getWorldMatrix(): Readonly<Matrix4> {
            if (this._worldDirty & TransformDirty.Matrix) {
                this._updateMatrix(true);
            }

            return this._worldMatrix;
        }
        /**
         * 该物体的世界矩阵。
         */
        public get worldMatrix(): Readonly<Matrix4> {
            if (this._worldDirty & TransformDirty.Matrix) {
                this._updateMatrix(true);
            }

            return this._worldMatrix;
        }
        /**
         * 将该物体位移指定距离。
         * @param isWorldSpace 是否是世界坐标系。
         */
        public translate(value: Readonly<IVector3>, isWorldSpace?: boolean): this;
        public translate(x: number, y: number, z: number, isWorldSpace?: boolean): this;
        public translate(p1: Readonly<IVector3> | number, p2?: boolean | number, p3?: number, p4?: boolean) {
            if (p1.hasOwnProperty("x")) {
                if (p2) {
                    this.position = this._localPosition.add(p1 as Readonly<IVector3>, this.position);
                }
                else {
                    this.localPosition = this._localPosition.add(p1 as Readonly<IVector3>);
                }
            }
            else {
                _helpVector3.set(p1 as number, p2 as number, p3 as number);

                if (p4) {
                    this.position = this._localPosition.add(_helpVector3, this.position);
                }
                else {
                    this.localPosition = this._localPosition.add(_helpVector3);
                }
            }

            return this;
        }
        /**
         * 将该物体旋转指定的欧拉弧度。
         * @param isWorldSpace 是否是世界坐标系。
         */
        public rotate(value: Readonly<IVector3>, isWorldSpace?: boolean, order?: EulerOrder): this;
        public rotate(x: number, y: number, z: number, isWorldSpace?: boolean, order?: EulerOrder): this;
        public rotate(p1: Readonly<IVector3> | number, p2?: boolean | number, p3?: EulerOrder | number, p4?: boolean, p5?: EulerOrder) {
            if (p1.hasOwnProperty("x")) {
                if (p2) {
                    this.euler = this._localEuler.add(p1 as Readonly<IVector3>, this.euler);
                }
                else {
                    this.localEuler; // Update euler.
                    this.localEuler = this._localEuler.add(p1 as Readonly<IVector3>);
                }
            }
            else {
                _helpVector3.set(p1 as number, p2 as number, p3 as number);

                if (p4) {
                    this.euler = this._localEuler.add(_helpVector3, this.euler);
                }
                else {
                    this.localEuler; // Update euler.
                    this.localEuler = this._localEuler.add(_helpVector3);
                }
            }

            return this;
        }
        /**
         * 将该物体绕指定轴旋转指定弧度。
         * @param axis 指定轴。
         * @param radian 指定弧度。
         * @param isWorldSpace 是否是世界坐标系。
         */
        public rotateOnAxis(axis: Readonly<IVector3>, radian: number, isWorldSpace?: boolean) {
            _helpRotation.fromAxis(axis, radian);

            if (isWorldSpace) {
                this.localRotation = this._localRotation.premultiply(_helpRotation).normalize();
            }
            else {
                this.localRotation = this._localRotation.multiply(_helpRotation).normalize();
            }

            return this;
        }
        /**
         * 将该物体绕世界指定点和世界指定轴旋转指定弧度。
         * @param worldPosition 世界指定点。
         * @param worldAxis 世界指定轴。
         * @param radian 指定弧度。
         */
        public rotateAround(worldPosition: Readonly<IVector3>, worldAxis: Readonly<IVector3>, radian: number) {
            this.rotateOnAxis(worldAxis, radian, true);
            this.position = this._localPosition.applyMatrix(_helpMatrix.fromRotation(_helpRotation.fromAxis(worldAxis, radian)).fromTranslate(worldPosition, true), this.position);

            return this;
        }
        /**
         * 将该物体旋转指定的欧拉角度。
         * @param isWorldSpace 是否是世界坐标系。
         */
        public rotateAngle(value: Readonly<IVector3>, isWorldSpace?: boolean, order?: EulerOrder): this;
        public rotateAngle(x: number, y: number, z: number, isWorldSpace?: boolean, order?: EulerOrder): this;
        public rotateAngle(p1: Readonly<IVector3> | number, p2?: boolean | number, p3?: EulerOrder | number, p4?: boolean, p5?: EulerOrder) {
            if (p1.hasOwnProperty("x")) {
                if (p2) {
                    this.eulerAngles = this._localEulerAngles.add(p1 as Readonly<IVector3>, this.eulerAngles);
                }
                else {
                    this.localEulerAngles; // Update euler.
                    this.localEulerAngles = this._localEulerAngles.add(p1 as Readonly<IVector3>);
                }
            }
            else {
                _helpVector3.set(p1 as number, p2 as number, p3 as number);

                if (p4) {
                    this.eulerAngles = this._localEulerAngles.add(_helpVector3, this.eulerAngles);
                }
                else {
                    this.localEulerAngles; // Update euler.
                    this.localEulerAngles = this._localEulerAngles.add(_helpVector3);
                }
            }

            return this;
        }
        /**
         * 将该物体绕指定轴旋转指定角度。
         * @param axis 指定轴。
         * @param angle 指定角度。
         * @param isWorldSpace 是否是世界坐标系。
         */
        public rotateAngleOnAxis(axis: Readonly<IVector3>, angle: number, isWorldSpace?: boolean) {
            return this.rotateOnAxis(axis, angle * DEG_RAD, isWorldSpace);
        }
        /**
         * 将该物体绕世界指定点和世界指定轴旋转指定角度。
         * @param worldPosition 世界指定点。
         * @param worldAxis 世界指定轴。
         * @param angle 指定角度。
         */
        public rotateAngleAround(worldPosition: Readonly<IVector3>, worldAxis: Readonly<IVector3>, angle: number) {
            return this.rotateAround(worldPosition, worldAxis, angle * DEG_RAD);
        }
        /**
         * 获取该物体在世界空间坐标系下描述的 X 轴正方向。
         */
        public getRight(out?: Vector3) {
            if (!out) {
                out = Vector3.create();
            }

            return out.applyDirection(this.worldMatrix, Vector3.RIGHT).normalize();
        }
        /**
         * 获取该物体在世界空间坐标系下描述的 Y 轴正方向。
         */
        public getUp(out?: Vector3) {
            if (!out) {
                out = Vector3.create();
            }

            return out.applyDirection(this.worldMatrix, Vector3.UP).normalize();
        }
        /**
         * 获取该物体在世界空间坐标系下描述的 Z 轴正方向。
         */
        public getForward(out?: Vector3) {
            if (!out) {
                out = Vector3.create();
            }

            return out.applyDirection(this.worldMatrix, Vector3.FORWARD).normalize();
        }
        /**
         * 通过旋转使得该物体的 Z 轴正方向指向目标。
         * @param target 目标。
         * @param up 旋转后，该物体在世界空间坐标系下描述的 Y 轴正方向。
         */
        public lookAt(target: Readonly<Transform> | Readonly<IVector3>, up: Readonly<IVector3> = Vector3.UP) {
            this.rotation = this._localRotation.fromMatrix(
                _helpMatrix.lookAt(
                    this.position,
                    target instanceof Transform ? target.position : target as Readonly<IVector3>,
                    up
                )
            );

            return this;
        }
        /**
         * 该组件实体的全部子级变换组件总数。
         */
        public get childCount(): number {
            return this._children.length;
        }
        /**
         * 该组件实体的全部子级变换组件。
         */
        @paper.serializedField
        @paper.deserializedIgnore
        public get children(): ReadonlyArray<Transform> {
            return this._children;
        }
        /**
         * 该组件实体的父级变换组件。
         */
        public get parent() {
            return this._parent;
        }
        public set parent(value: Transform | null) {
            this.setParent(value, false);
        }
    }
}
