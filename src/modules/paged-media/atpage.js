import Handler from "../handler";
import csstree from 'css-tree';
import pageSizes from '../../polisher/sizes';
import { rebuildAncestors, elementAfter } from "../../utils/dom";

class AtPage extends Handler {
	constructor(chunker, polisher, caller) {
		super(chunker, polisher, caller);

		this.pages = {};

		this.width = undefined;
		this.height = undefined;
		this.orientation = undefined;

		this.marginalia = {};
	}

	pageModel(selector) {
		return {
			selector: selector,
			name: undefined,
			psuedo: undefined,
			nth: undefined,
			marginalia: {},
			width: undefined,
			height: undefined,
			orientation: undefined,
			margin : {
				top: {},
				right: {},
				left: {},
				bottom: {}
			},
			block: {},
			marks: undefined
		}
	}

	// Find and Remove @page rules
	onAtPage(node, item, list) {
		let page, marginalia;
		let selector = "";
		let name = "";
		let named, psuedo, nth;
		let needsMerge = false;

		if (node.prelude) {
			named = this.getTypeSelector(node);
			psuedo = this.getPsuedoSelector(node);
			nth = this.getNthSelector(node);
			selector = csstree.generate(node.prelude);
		} else {
			selector = "*";
		}

		if (selector in this.pages) {
			// this.pages[selector] = Object.assign(this.pages[selector], page);
			// console.log("after", selector, this.pages[selector]);

			// this.pages[selector].added = false;
			page = this.pages[selector];
			marginalia = this.replaceMarginalia(node);
			needsMerge = true;
		} else {
			page = this.pageModel(selector);
			marginalia = this.replaceMarginalia(node);
			this.pages[selector] = page;
		}

		page.name = named;
		page.psuedo = psuedo;
		page.nth = nth;

		if (needsMerge) {
			page.marginalia = Object.assign(page.marginalia, marginalia);
		} else {
			page.marginalia = marginalia;
		}

		let declarations = this.replaceDeclartations(node);

		if (declarations.size) {
			page.width = declarations.size.width;
			page.height = declarations.size.height;
			page.orientation = declarations.size.orientation;
		}

		if (declarations.margin) {
			page.margin = declarations.margin;
		}

		if (declarations.marks) {
			page.marks = declarations.marks;
		}

		if (needsMerge) {
			page.block.children.appendList(node.block.children);
		} else {
			page.block = node.block;
		}

		// Remove the rule
		list.remove(item);
	}

	/* Handled in breaks */
	/*
	afterParsed(parsed) {
		for (let b in this.named) {
			// Find elements
			let elements = parsed.querySelectorAll(b);
			// Add break data
			for (var i = 0; i < elements.length; i++) {
				elements[i].setAttribute("data-page", this.named[b]);
			}
		}
	}
	*/

	afterTreeWalk(ast, sheet) {
		this.addPageClasses(this.pages, ast, sheet);

		if ("*" in this.pages) {
			let width = this.pages["*"].width;
			let height = this.pages["*"].height;
			let orientation = this.pages["*"].orientation;

			if ((width && height) &&
			    (this.width !== width || this.height !== height)) {
				this.width = width;
				this.height = height;
				this.orientation = orientation;

				this.addRootVars(ast, width, height);
				this.addRootPage(ast, width, height);

				this.emit("size", { width, height, orientation });
			}

		}
	}

	getTypeSelector(ast) {
		// Find page name
		let name;

		csstree.walk(ast, {
			visit: "TypeSelector",
			enter: (node, item, list) => {
				name = node.name
			}
		});

		return name;
	}

	getPsuedoSelector(ast) {
		// Find if it has :left & :right & :black & :first
		let name;
		csstree.walk(ast, {
			visit: "PseudoClassSelector",
			enter: (node, item, list) => {
				if (node.name !== "nth") {
					name = node.name;
				}
			}
		});

		return name;
	}

	getNthSelector(ast) {
		// Find if it has :nth
		let nth;
		csstree.walk(ast, {
			visit: "PseudoClassSelector",
			enter: (node, item, list) => {
				if (node.name === "nth" && node.children) {
					let raw = node.children.first();
					nth = raw.value;
				}
			}
		});

		return nth;
	}

	replaceMarginalia(ast) {
		let parsed = {};

		csstree.walk(ast.block, {
			visit: 'Atrule',
			enter: (node, item, list) => {
				let name = node.name;
				if (name === "top") {
					name = "top-center";
				}
				if (name === "right") {
					name = "right-middle";
				}
				if (name === "left") {
					name = "left-middle";
				}
				if (name === "bottom") {
					name = "bottom-center";
				}
				parsed[name] = node.block;
				list.remove(item);
			}
		});

		return parsed;
	}

	replaceDeclartations(ast) {
		let parsed = {};

		csstree.walk(ast.block, {
			visit: 'Declaration',
			enter: (declaration, dItem, dList) => {
				let prop = csstree.property(declaration.property).name;
				let value = declaration.value;
				if (prop === "marks") {
					parsed.marks = value.children.first().name;
					dList.remove(dItem);
				} else if (prop === "margin") {
					parsed.margin = this.getMargins(declaration);
					dList.remove(dItem);
				} else if (prop.indexOf("margin-") === 0) {
					let m = prop.substring("margin-".length);
					if (!parsed.margin) {
						parsed.margin = {
							top: {},
							right: {},
							left: {},
							bottom: {}
						};
					}
					parsed.margin[m] = declaration.value.children.first();
					dList.remove(dItem);
				} else if (prop === "size") {
					parsed.size = this.getSize(declaration);
					dList.remove(dItem);
				}

			}
		})

		return parsed;
	}

	getSize(declaration) {
		let width, height, orientation;

		// Get size: Xmm Ymm
		csstree.walk(declaration, {
			visit: 'Dimension',
			enter: (node, item, list) => {
				let {value, unit} = node;
				if (typeof width === "undefined") {
					width = { value, unit };
				} else if (typeof height === "undefined") {
					height = { value, unit };
				}
			}
		});

		// Get size: 'A4'
		csstree.walk(declaration, {
			visit: 'String',
			enter: (node, item, list) => {
				let name = node.value.replace(/["|']/g, '');
				let s = pageSizes[name];
				if (s) {
					width = s.width;
					height = s.height;
				}
			}
		});

		// Get Format or Landscape or Portrait
		csstree.walk(declaration, {
			visit: "Identifier",
			enter: (node, item, list) => {
				let name = node.name;
				if (name === "landscape" || name === "portrait") {
					orientation = node.name;
				} else if (name !== "auto") {
					let s = pageSizes[name];
					if (s) {
						width = s.width;
						height = s.height;
					}
				}
			}
		});

		return {
			width,
			height,
			orientation
		}
	}

	getMargins(declaration) {
		let margins = [];
		let margin = {
			top: {},
			right: {},
			left: {},
			bottom: {}
		};

		csstree.walk(declaration, {
			visit: 'Dimension',
			enter: (node, item, list) => {
				margins.push(node);
			}
		});

		if (margins.length === 1) {
			for (let m in margin) {
				margin[m] = margins[0];
			}
		} else if (margins.length === 2) {
			margin.top = margins[0];
			margin.right = margins[1];
			margin.bottom = margins[0];
			margin.left = margins[1];
		} else if (margins.length === 3) {
			margin.top = margins[0];
			margin.right = margins[1];
			margin.bottom = margins[2];
			margin.left = margins[1];
		} else if (margins.length === 4) {
			margin.top = margins[0];
			margin.right = margins[1];
			margin.bottom = margins[2];
			margin.left = margins[3];
		}

		return margin;
	}

	addPageClasses(pages, ast, sheet) {
		// First add * page
		if ("*" in pages && !pages["*"].added) {
			let p = this.createPage(pages["*"], ast.children, sheet);
			sheet.insertRule(p);
			pages["*"].added = true;
		}
		// Add :left & :right
		if (":left" in pages && !pages[":left"].added) {
			let left = this.createPage(pages[":left"], ast.children, sheet);
			sheet.insertRule(left);
			pages[":left"].added = true;
		}
		if (":right" in pages && !pages[":right"].added) {
			let right = this.createPage(pages[":right"], ast.children, sheet);
			sheet.insertRule(right);
			pages[":right"].added = true;
		}
		// Add :first & :blank
		if (":first" in pages && !pages[":first"].first) {
			let first = this.createPage(pages[":first"], ast.children, sheet);
			sheet.insertRule(first);
			pages[":first"].added = true;
		}
		if (":blank" in pages && !pages[":blank"].added) {
			let blank = this.createPage(pages[":blank"], ast.children, sheet);
			sheet.insertRule(blank);
			pages[":blank"].added = true;
		}
		// Add nth pages
		for (let pg in pages) {
			if (pages[pg].nth && !pages[pg].added) {
				let nth = this.createPage(pages[pg], ast.children, sheet);
				sheet.insertRule(nth);
				pages[pg].added = true;
			}
		}

		// Add named pages
		for (let pg in pages) {
			if (pages[pg].name && !pages[pg].added) {
				let named = this.createPage(pages[pg], ast.children, sheet);
				sheet.insertRule(named);
				pages[pg].added = true;
			}
		}

	}

	createPage(page, ruleList, sheet) {

		let selectors = this.selectorsForPage(page);
		let children = page.block.children.copy();
		let block = {
				type: 'Block',
				loc: 0,
				children: children
		};
		let rule = this.createRule(selectors, block);

		this.addMarginVars(page.margin, children, children.first());

		if (page.width) {
			this.addDimensions(page.width, page.height, children, children.first());
		}

		if (page.marginalia) {
			this.addMarginaliaStyles(page, ruleList, rule, sheet);
			this.addMarginaliaContent(page, ruleList, rule, sheet);
		}

		return rule;
	}

	addMarginVars(margin, list, item) {
		// variables for margins
		for (let m in margin) {
			if (typeof margin[m].value !== "undefined") {
				let value = margin[m].value + (margin[m].unit || '');
				let mVar = list.createItem({
					type: 'Declaration',
					property: "--margin-" + m,
					value: {
						type: "Raw",
						value: value
					}
				});
				list.append(mVar, item);
			}
		}
	}

	addDimensions(width, height, list, item) {
		// width variable
		let wVar = this.createVariable("--width", width.value + (width.unit || ''));
		list.appendData(wVar);

		// height variable
		let hVar = this.createVariable("--height", height.value + (height.unit || ''));
		list.appendData(hVar);

		// width dimension
		let w = this.createDimension("width", width.value, width.unit);
		list.appendData(w);

		// height dimension
		let h = this.createDimension("height", height.value, height.unit);
		list.appendData(h);
	}

	addMarginaliaStyles(page, list, item, sheet) {
		for (let loc in page.marginalia) {
			let block = csstree.clone(page.marginalia[loc]);
			let hasContent = false;

			if(block.children.isEmpty()) {
				continue;
			}

			csstree.walk(block, {
				visit: "Declaration",
				enter: (node, item, list) => {
					if (node.property === "content") {
						if (node.value.children && node.value.children.first().name === "none") {
							hasContent = false;
						} else {
							hasContent = true;
						}
						list.remove(item);
					}
					if (node.property === "vertical-align") {
						csstree.walk(node, {
							visit: "Identifier",
							enter: (identNode, identItem, identlist) => {
								let name = identNode.name;
								if (name === "top") {
									identNode.name = "flex-start";
								} else if (name === "middle") {
									identNode.name = "center";
								} else if (name === "bottom") {
									identNode.name = "flex-end";
								}
							}
						});
						node.property = "align-items";
					}

					if (node.property === "width" &&
						(loc === "top-left" ||
						 loc === "top-center" ||
						 loc === "top-right" ||
						 loc === "bottom-left" ||
						 loc === "bottom-center" ||
						 loc === "bottom-right")) {
							let c = csstree.clone(node);
							c.property = "max-width";
							list.appendData(c);
					}

					if (node.property === "height" &&
						(loc === "left-top" ||
						 loc === "left-middle" ||
						 loc === "left-bottom" ||
						 loc === "right-top" ||
						 loc === "right-middle" ||
						 loc === "right-bottom")) {
							let c = csstree.clone(node);
							c.property = "max-height";
							list.appendData(c);
					}
				}
			});

			let marginSelectors = this.selectorsForPageMargin(page, loc);
			let marginRule = this.createRule(marginSelectors, block);

			list.appendData(marginRule);

			let sel = csstree.generate({
				type: 'Selector',
				children: marginSelectors
			});

			this.marginalia[sel] = {
				page: page,
				selector: sel,
				block: page.marginalia[loc],
				hasContent: hasContent
			}

		}
	}

	addMarginaliaContent(page, list, item, sheet) {
		let displayNone;
		// Just content
		for (let loc in page.marginalia) {
			let content = csstree.clone(page.marginalia[loc]);
			csstree.walk(content, {
				visit: "Declaration",
				enter: (node, item, list) => {
					if (node.property !== "content") {
						list.remove(item);
					}

					if (node.value.children && node.value.children.first().name === "none") {
						displayNone = true;
					}
				}
			});

			if(content.children.isEmpty()) {
				continue;
			}

			let displaySelectors = this.selectorsForPageMargin(page, loc);
			let displayDeclaration;

			displaySelectors.insertData({
				type: 'Combinator',
				name: ">"
			});

			displaySelectors.insertData({
				type: 'ClassSelector',
				name: "pagedjs_margin-content"
			});

			displaySelectors.insertData({
				type: 'Combinator',
				name: ">"
			});

			displaySelectors.insertData({
				type: 'TypeSelector',
				name: "*"
			});

			if (displayNone) {
				displayDeclaration = this.createDeclaration("display", "none");
			} else {
				displayDeclaration = this.createDeclaration("display", "block");
			}

			let displayRule = this.createRule(displaySelectors, [displayDeclaration]);
			sheet.insertRule(displayRule);

			// insert content rule
			let contentSelectors = this.selectorsForPageMargin(page, loc);

			contentSelectors.insertData({
				type: 'Combinator',
				name: ">"
			});

			contentSelectors.insertData({
				type: 'ClassSelector',
				name: "pagedjs_margin-content"
			});

			contentSelectors.insertData({
				type: 'PseudoElementSelector',
				name: "after",
				children: null
			});

			let contentRule = this.createRule(contentSelectors, content);
			sheet.insertRule(contentRule);
		}
	}

	addRootVars(ast, width, height) {
		let selectors = new csstree.List();
		selectors.insertData({
			type: "PseudoClassSelector",
			name: "root",
			children: null
		});

		// width variable
		let wVar = this.createVariable("--width", width.value + (width.unit || ''));

		// height variable
		let hVar = this.createVariable("--height", height.value + (height.unit || ''));

		let rule = this.createRule(selectors, [wVar, hVar])

		ast.children.appendData(rule);
	}

	addRootPage(ast, width, height) {
		/*
		@page {
			size: var(--width) var(--height);
			margin: 0;
			padding: 0;
		}
		*/
		let children = new csstree.List();
		let dimensions = new csstree.List();

		dimensions.appendData({
			type: 'Dimension',
			unit: width.unit,
			value: width.value
		});

		dimensions.appendData({
			type: 'WhiteSpace',
			value: " "
		});

		dimensions.appendData({
			type: 'Dimension',
			unit: height.unit,
			value: height.value
		});

		children.appendData({
			type: 'Declaration',
			property: "size",
			loc: null,
			value: {
				type: "Value",
				children: dimensions
			}
		});

		children.appendData({
			type: 'Declaration',
			property: "margin",
			loc: null,
			value: {
				type: "Value",
				children: [{
					type: 'Dimension',
					unit: 'px',
					value: 0
				}]
			}
		});

		children.appendData({
			type: 'Declaration',
			property: "padding",
			loc: null,
			value: {
				type: "Value",
				children: [{
					type: 'Dimension',
					unit: 'px',
					value: 0
				}]
			}
		});


		let rule = ast.children.createItem({
			type: 'Atrule',
			prelude: null,
			name: "page",
			block: {
					type: 'Block',
					loc: null,
					children: children
			}
		});

		ast.children.append(rule);
	}

	getNth(nth) {
		let n = nth.indexOf("n");
		let plus = nth.indexOf("+");
		let splitN = nth.split("n");
		let splitP = nth.split("+");
		let a = null;
		let b = null;
		if (n > -1) {
			a = splitN[0];
			if (plus > -1) {
				b = splitP[1];
			}
		} else {
			b = nth;
		}

		return {
			type: 'Nth',
			loc: null,
			selector: null,
			nth: {
				type: "AnPlusB",
				loc: null,
				a: a,
				b: b
			}
		}
	}

	addPageAttributes(page, start, pages) {
		let named = start.dataset.page;

		if (named) {
			page.name = named;
			page.element.classList.add("pagedjs_named_page");
			page.element.classList.add("pagedjs_" + named + "_page");

			if (!start.dataset.splitFrom) {
				page.element.classList.add("pagedjs_" + named + "_first_page");
			}
		}
	}

	getStartElement(content, breakToken) {
		let start = content;
		let node = breakToken && breakToken.node;
		let index, ref, parent;

		if (!content && !breakToken) {
			return;
		}

		// No break
		if (!node) {
			return content.children[0];
		}

		// Top level element
		if (node.nodeType === 1 && node.parentNode.nodeType === 11) {
			return node;
		}

		// Named page
		if (node.nodeType === 1 && node.dataset.page) {
			return node;
		}

		// Get top level Named parent
		let fragment = rebuildAncestors(node);
		let pages = fragment.querySelectorAll("[data-page]");

		if (pages.length) {
			return pages[pages.length - 1];
		} else {
			return fragment.children[0];
		}
	}

	beforePageLayout(page, contents, breakToken, chunker) {
		let start = this.getStartElement(contents, breakToken);
		if (start) {
			this.addPageAttributes(page, start, chunker.pages);
		}
	}

	afterPageLayout(fragment, page, breakToken, chunker) {
		for (let m in this.marginalia) {
			let margin = this.marginalia[m];
			let sels = m.split(" ");

			let content;
			if (page.element.matches(sels[0]) && margin.hasContent) {
				content = page.element.querySelector(sels[1]);
				content.classList.add("hasContent");
			}
		}

		// check center
		["top", "bottom"].forEach((loc) => {
			let marginGroup = page.element.querySelector(".pagedjs_margin-" + loc);
			let center = page.element.querySelector(".pagedjs_margin-" + loc + "-center.hasContent");
			let left = page.element.querySelector(".pagedjs_margin-" + loc + "-left");
			let right = page.element.querySelector(".pagedjs_margin-" + loc + "-right");

				let leftContent = left.classList.contains("hasContent");
				let rightContent = right.classList.contains("hasContent");
				let centerWidth, leftWidth, rightWidth;

				if (leftContent) {
					leftWidth = window.getComputedStyle(left)["max-width"];
				}

				if (rightContent) {
					rightWidth = window.getComputedStyle(right)["max-width"];
				}


			if (center) {

				console.log(marginGroup);
				//marginGroup.style["grid-template-columns"] = "1fr 300px 1fr";

				
				
				centerWidth = window.getComputedStyle(center)["max-width"];

				

				if(centerWidth === "none" || centerWidth === "auto") {
					/* center computed auto */
					console.log("Center auto");

					if(!leftContent && !rightContent){
						console.log("center only");
						marginGroup.style["grid-template-columns"] = "0 1fr 0";
					}else if(leftContent){{}
						if(!rightContent){
							console.log("left + center");
							if(leftWidth !== "none" && leftWidth !== "auto"){
								console.log("left size + center auto");
								marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + leftWidth;
							}
						}else{
							console.log("left + center auto + right");
							if(leftWidth !== "none" && leftWidth !== "auto"){
								if(rightWidth !== "none" && rightWidth !== "auto"){
									console.log("left size + center auto + right size");
									marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + rightWidth;
								}else{
									console.log("left size + center auto + right auto");
									marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + leftWidth;
								}
							}else{
								console.log("left auto + center auto + right");
								if(rightWidth !== "none" && rightWidth !== "auto"){ 
									marginGroup.style["grid-template-columns"] = rightWidth + " 1fr " + rightWidth;
								}
							}
						}
					}else{
						if(rightWidth !== "none" && rightWidth !== "auto"){
							console.log("none + center auto + right size");
							marginGroup.style["grid-template-columns"] = rightWidth + " 1fr " + rightWidth;
						}
					}
					
			
				}else if(centerWidth !== "none" && centerWidth !== "auto"){
					/* center computed size */
					console.log("Center size");	
					
					
					if(leftContent && leftWidth !== "none" && leftWidth !== "auto"){
						console.log("left size + center size");	
						marginGroup.style["grid-template-columns"] = leftWidth + " " + centerWidth + " 1fr";
					}else if(rightContent && rightWidth !== "none" && rightWidth !== "auto"){
						console.log("left size + right size");	
						marginGroup.style["grid-template-columns"] = "1fr " + centerWidth + " " + rightWidth;
					}else{
						marginGroup.style["grid-template-columns"] = "1fr " + centerWidth + " 1fr";
					}

				}

			}else{
				if(leftContent){
					if(!rightContent){
						marginGroup.style["grid-template-columns"] = "1fr 0 0";		
					}else{
						if(leftWidth !== "none" && leftWidth !== "auto"){
							if(rightWidth !== "none" && rightWidth !== "auto"){
								marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + rightWidth;
							}else{
								marginGroup.style["grid-template-columns"] = leftWidth + " 0 1fr";
							}					
						}else{
							if(rightWidth !== "none" && rightWidth !== "auto"){
								marginGroup.style["grid-template-columns"] = "1fr 0 " + rightWidth;
							}else{
								marginGroup.style["grid-template-columns"] = "1fr 0 1fr";
							}										
						}		
					}
				}else{
					if(rightWidth !== "none" && rightWidth !== "auto"){
						marginGroup.style["grid-template-columns"] = "1fr 0 " + rightWidth;
					}else{
						marginGroup.style["grid-template-columns"] = "0 0 1fr";
					}				
				}
				
			}
			// } 
		});

		// check middle
		["left", "right"].forEach((loc) => {
			let middle = page.element.querySelector(".pagedjs_margin-" + loc + "-middle.hasContent");
			if (middle) {
				let top = page.element.querySelector(".pagedjs_margin-" + loc + "-top");
				let bottom = page.element.querySelector(".pagedjs_margin-" + loc + "-bottom");

				let topContent = top.classList.contains("hasContent");
				let bottomContent = bottom.classList.contains("hasContent");
				let middleHeight, topHeight, bottomHeight;

				if (topContent && !bottomContent) {
					bottom.classList.add("emptyBalance");
				}

				if (!topContent && bottomContent) {
					top.classList.add("emptyBalance");
				}

				// Balance Sizes
				if (topContent) {
					topHeight = window.getComputedStyle(top)["max-height"];
				}

				if (bottomContent) {
					bottomHeight = window.getComputedStyle(bottom)["max-height"];
				}

				middleHeight = window.getComputedStyle(middle)["max-height"];

				// Over-contrained
				if (middleHeight !== "none" && middleHeight !== "auto") {
					top.style["height"] = "auto";
					top.style["max-height"] = "none";
					bottom.style["height"] = "auto";
					bottom.style["max-height"] = "none";
				} else if ((middleHeight === "none" || middleHeight === "auto") &&
						topContent && topHeight !== "none" && topHeight !== "auto" &&
						bottomContent && bottomHeight !== "none" && bottomHeight !== "auto") {

					// TODO: convert units before comparing
					let newHeight = Math.max(parseFloat(topHeight), parseFloat(bottomHeight));

					// Add units back
					newHeight += topHeight.replace(parseFloat(topHeight), "");

					top.style["height"] = newHeight;
					top.style["max-height"] = newHeight;
					// top.style["min-height"] = newHeight;
					bottom.style["height"] = newHeight;
					bottom.style["max-height"] = newHeight;
					// left.style["min-height"] = newHeight;
				} else {
					if (topHeight !== "none" && topHeight !== "auto") {
						bottom.style["max-height"] = topHeight;
					}

					if (bottomHeight !== "none" && bottomHeight !== "auto") {
						top.style["max-height"] = bottomHeight;
					}
				}
			}
		});

	}

	// CSS Tree Helpers

	selectorsForPage(page) {
		let nthlist;
		let nth;

		let selectors = new csstree.List();

		selectors.insertData({
			type: 'ClassSelector',
			name: 'pagedjs_page'
		});

		// Named page
		if (page.name) {
			selectors.insertData({
				type: 'ClassSelector',
				name: "pagedjs_named_page"
			});

			name = page.name + "_page";
			selectors.insertData({
				type: 'ClassSelector',
				name: "pagedjs_" + page.name + "_page"
			});
		}

		// PsuedoSelector
		if (page.psuedo && !(page.name && page.psuedo === "first")) {
			selectors.insertData({
				type: 'ClassSelector',
				name: "pagedjs_" + page.psuedo + "_page"
			});
		}

		if (page.name && page.psuedo === "first") {
			selectors.insertData({
				type: 'ClassSelector',
				name: "pagedjs_" + page.name + "_" + page.psuedo + "_page"
			});
		}

		// Nth
		if (page.nth) {
			nthlist = new csstree.List();
			nth = this.getNth(page.nth);

			nthlist.insertData(nth);

			selectors.insertData({
				type: 'PseudoClassSelector',
				name: 'nth-of-type',
				children: nthlist
			});
		}

		return selectors;
	}

	selectorsForPageMargin(page, margin) {
		let selectors = this.selectorsForPage(page);

		selectors.insertData({
			type: 'Combinator',
			name: " "
		});

		selectors.insertData({
			type: 'ClassSelector',
			name: "pagedjs_margin-" + margin
		});

		return selectors;
	}

	createDeclaration(property, value, important) {
		let children = new csstree.List();

		children.insertData({
			type: "Identifier",
			loc: null,
			name: value
		});

		return {
			type: "Declaration",
			loc: null,
			important: important,
			property: property,
			value: {
				type: "Value",
				loc: null,
				children: children
			}
		}
	}

	createVariable(property, value) {
		return {
			type: "Declaration",
			loc: null,
			property: property,
			value: {
				type: "Raw",
				value: value
			}
		}
	}

	createDimension(property, value, unit, important) {
		let children = new csstree.List();

		children.insertData({
			type: "Dimension",
			loc: null,
			value: value,
			unit: unit
		});

		return {
			type: "Declaration",
			loc: null,
			important: important,
			property: property,
			value: {
				type: "Value",
				loc: null,
				children: children
			}
		}
	}

	createBlock(declarations) {
		let block = new csstree.List();

		declarations.forEach((declaration) => {
			block.insertData(declaration);
		});

		return {
			type: 'Block',
			loc: null,
			children: block
		}
	}

	createRule(selectors, block) {
		let selectorList = new csstree.List();
		selectorList.insertData({
			type: 'Selector',
			children: selectors
		});

		if (Array.isArray(block)) {
			block = this.createBlock(block);
		}

		return {
			type: 'Rule',
			prelude: {
				type: 'SelectorList',
				children: selectorList
			},
			block: block
		};
	}

}

export default AtPage;
